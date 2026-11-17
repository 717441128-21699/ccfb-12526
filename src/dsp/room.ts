import { FractionalDelay } from './filters.js';
import { dbToGain } from '../core/mathUtils.js';
import type { Room } from '../core/types.js';

/**
 * 单房间混响引擎（单声道入，双耳出）。
 * 结构：预延迟 → 6 抽头早期反射（短延时，带左右耳差，保留空间方位感）
 *            → 8 线 Hadamard FDN 晚期混响（每线独立吸收低通，频率相关衰减）
 *
 * 室内：RT60 0.4–1.2s，反射密；室外：RT60 很短、湿声电平极低，仅留一点早期反射。
 * 场景切换不在本类内部处理 —— 渲染器同时持有 A/B 两个引擎做等功率交叉淡化，
 * 旧房间的混响尾巴在淡化期间自然衰减完毕。
 *
 * 性能约定：延迟线容量均为 2 的幂（位掩码索引）；所有每块恒定的延迟/系数
 * 在 process() 入口预计算一次；低通状态内联，热路径零函数调用。
 */

const FDN_ORDER = 8;
const BASE_DELAYS = [29.7, 37.1, 41.9, 46.3, 53.1, 59.9, 67.3, 73.9]; // 毫秒，互质分布
const EARLY_TAPS = [7.2, 11.9, 17.3, 23.1, 29.7, 38.4]; // 毫秒
const EARLY_GAINS = [0.55, 0.45, 0.38, 0.3, 0.24, 0.18];
const EARLY_LR_SHIFT = [0.0011, -0.0009, 0.0007, -0.0006, 0.0005, -0.0004]; // 双耳时间差（秒）

function hadamard8(x: Float32Array): void {
  // 原地 8 阶 Hadamard，H8 正交，1/sqrt(8) 归一化
  for (let len = 1; len < 8; len *= 2) {
    for (let i = 0; i < 8; i += len * 2) {
      for (let j = 0; j < len; j++) {
        const a = x[i + j]!;
        const b = x[i + j + len]!;
        x[i + j] = a + b;
        x[i + j + len] = a - b;
      }
    }
  }
  const k = 1 / Math.sqrt(8);
  for (let i = 0; i < 8; i++) x[i]! *= k;
}

export class RoomEngine {
  private sampleRate: number;
  private wetGain = 0;
  private earlyGain = 0;
  private predelay: FractionalDelay;
  private earlyL: FractionalDelay;
  private earlyR: FractionalDelay;
  private lineDelay: FractionalDelay[] = [];
  // 每线低通的内联状态与系数
  private lineZ = new Float32Array(FDN_ORDER);
  private lineA1 = new Float32Array(FDN_ORDER);
  private lineB0 = new Float32Array(FDN_ORDER);
  private feedback = new Float32Array(FDN_ORDER);
  private m = new Float32Array(FDN_ORDER);
  private current: Room;

  constructor(room: Room, sampleRate: number) {
    this.sampleRate = sampleRate;
    this.current = room;
    this.predelay = new FractionalDelay(Math.ceil(0.14 * sampleRate) + 4);
    this.earlyL = new FractionalDelay(Math.ceil(0.06 * sampleRate) + 4);
    this.earlyR = new FractionalDelay(Math.ceil(0.06 * sampleRate) + 4);
    for (let i = 0; i < FDN_ORDER; i++) {
      this.lineDelay.push(new FractionalDelay(Math.ceil(0.12 * sampleRate) + 4));
    }
    this.setRoom(room);
  }

  setRoom(room: Room): void {
    this.current = room;
    this.wetGain = dbToGain(room.levelDb);
    this.earlyGain = room.kind === 'outdoor' ? 0.25 : 0.9;
    const sr = this.sampleRate;
    for (let i = 0; i < FDN_ORDER; i++) {
      // 反馈系数由 RT60 与该线延时反推：g = 0.001^(delay/RT60)
      const delaySec = (BASE_DELAYS[i]! / 1000) * (room.roomSize / 12);
      const g = Math.pow(0.001, delaySec / Math.max(0.05, room.rt60));
      this.feedback[i] = Math.min(0.95, g);
      // 高频阻尼：阻尼越强截止越低，奇数线略错开，避免染色
      const spread = 0.85 + 0.15 * (i % 2);
      const fc = (300 + 9000 * (1 - room.hfDamping)) * spread;
      const x = Math.exp((-2 * Math.PI * Math.min(fc, sr * 0.45)) / sr);
      this.lineA1[i] = x;
      this.lineB0[i] = 1 - x;
    }
  }

  get room(): Room {
    return this.current;
  }

  /**
   * @param inMono 本块各声源汇入房间的单声道总线（已含 send 比例与墙损耗）
   * @param outL/outR 累加输出（不清零，与干声及另一房间叠加）
   */
  process(inMono: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    const sr = this.sampleRate;
    const room = this.current;
    // ---- 每块恒定参数，入口预计算一次 ----
    const preD = 2 + Math.max(0.001, room.roomSize * 0.0008) * sr;
    const sizeScale = room.roomSize / 12;
    const earlyDL = EARLY_TAPS.map((ms, k) => {
      const shift = EARLY_LR_SHIFT[k]! * sr;
      return 2 + (ms / 1000) * sizeScale * sr + Math.max(0, shift);
    });
    const earlyDR = EARLY_TAPS.map((ms, k) => {
      const shift = EARLY_LR_SHIFT[k]! * sr;
      return 2 + (ms / 1000) * sizeScale * sr + Math.max(0, -shift);
    });
    const fdnD = BASE_DELAYS.map((ms) => 2 + (ms / 1000) * sizeScale * sr);
    const wet = this.wetGain;
    const eGain = this.earlyGain;
    const eg = EARLY_GAINS.map((g) => g * eGain);

    const pre = this.predelay;
    const eLineL = this.earlyL;
    const eLineR = this.earlyR;
    const lines = this.lineDelay;
    const m = this.m;
    const fb = this.feedback;
    const a1 = this.lineA1;
    const b0 = this.lineB0;
    const z = this.lineZ;

    for (let i = 0; i < n; i++) {
      const x = inMono[i]!;
      pre.push(x);
      const pv = pre.read(preD);

      // ---- 早期反射（双耳时间差制造空间宽度）----
      eLineL.push(pv);
      eLineR.push(pv);
      let eL = 0;
      let eR = 0;
      for (let k = 0; k < 6; k++) {
        eL += eg[k]! * eLineL.read(earlyDL[k]!);
        eR += eg[k]! * eLineR.read(earlyDR[k]!);
      }

      // ---- FDN 晚期混响（低通状态内联）----
      for (let j = 0; j < FDN_ORDER; j++) m[j] = lines[j]!.read(fdnD[j]!);
      hadamard8(m);
      let wetSum = 0;
      for (let j = 0; j < FDN_ORDER; j++) {
        const v = m[j]!;
        let lp = b0[j]! * v + a1[j]! * z[j]!;
        if (Math.abs(lp) < 1e-15) lp = 0; // FTZ
        z[j] = lp;
        let fed = lp * fb[j]! + pv * 0.19;
        if (Math.abs(fed) < 1e-15) fed = 0;
        lines[j]!.push(fed);
        wetSum += v;
      }

      outL[i]! += wet * (eL + 0.32 * wetSum);
      outR[i]! += wet * (eR + 0.32 * wetSum);
    }
  }

  reset(): void {
    this.predelay.reset();
    this.earlyL.reset();
    this.earlyR.reset();
    for (const d of this.lineDelay) d.reset();
    this.lineZ.fill(0);
  }
}
