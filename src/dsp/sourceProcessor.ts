import { ParametricHrtf } from './hrtf.js';
import type { HrtfParams } from './hrtf.js';
import { dbToGain, smoothstep } from '../core/mathUtils.js';
import type { RelativeSpatial } from '../core/geometry.js';
import type { OcclusionResult } from '../core/occlusion.js';
import type { SourceTrack } from '../core/types.js';

/** 一阶低通系数 + 状态（三个滤波器结构相同，内联融合用） */
interface OnePole {
  b0: number;
  a1: number;
  z: number;
}

const makePole = (): OnePole => ({ b0: 1, a1: 0, z: 0 });

function setCutoff(p: OnePole, fc: number, sampleRate: number): void {
  if (fc <= 0 || fc >= sampleRate * 0.499) {
    p.b0 = 1;
    p.a1 = 0;
    return;
  }
  const x = Math.exp((-2 * Math.PI * fc) / sampleRate);
  p.a1 = x;
  p.b0 = 1 - x;
}

/**
 * 单个声源的完整处理链（每轨一个实例）：
 *   素材 → 基础增益 → 指向性（背对听者掉高频）→ 穿墙低通/衰减
 *        → 距离增益 + 空气吸声 → 参数化 HRTF → 左右耳累加
 *   另取一路经墙损耗后的信号作为房间发送（远声混响占比更高）。
 * 增益/滤波在同一个热循环内融合完成，每子块仅三遍（融合级联、双耳×2）。
 */
export class SourceProcessor {
  readonly track: SourceTrack;
  private hrtf: ParametricHrtf;
  private dirPole = makePole();
  private occPole = makePole();
  private airPole = makePole();
  private baseGain: number;
  private gainSmoothed = 0;
  private sampleRate: number;
  private postScratch: Float32Array;
  private outL: Float32Array;
  private outR: Float32Array;

  constructor(track: SourceTrack, sampleRate: number, subBlock: number) {
    this.track = track;
    this.sampleRate = sampleRate;
    this.baseGain = dbToGain(track.gainDb);
    this.hrtf = new ParametricHrtf(sampleRate, subBlock);
    this.postScratch = new Float32Array(subBlock);
    this.outL = new Float32Array(subBlock);
    this.outR = new Float32Array(subBlock);
  }

  reset(): void {
    this.hrtf.reset();
    this.dirPole = makePole();
    this.occPole = makePole();
    this.airPole = makePole();
    this.gainSmoothed = 0;
  }

  /**
   * 尾部门控：源已停止，但房间混响尾巴还需自然衰减。
   * 只跑融合滤波 + 房间发送（输入静音），跳过 HRTF 干声；
   * 电平衰减到听阈以下后由渲染器彻底跳过。
   * @returns 当前尾音电平（用于调用方决定何时彻底关闭）
   */
  processTail(n: number, roomBus: Float32Array, roomOffset: number): number {
    const dp = this.dirPole;
    const op = this.occPole;
    const ap = this.airPole;
    let zDir = dp.z;
    let zOcc = op.z;
    let zAir = ap.z;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      zDir = dp.a1 * zDir;
      zOcc = op.a1 * zOcc;
      zAir = ap.a1 * zAir;
      if (Math.abs(zAir) < 1e-15) {
        zDir = 0;
        zOcc = 0;
        zAir = 0;
      }
      const v = zAir;
      roomBus[roomOffset + i]! += v * 0.32;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    dp.z = zDir;
    op.z = zOcc;
    ap.z = zAir;
    return peak;
  }

  process(
    n: number,
    readMono: (out: Float32Array, n: number) => void,
    spatial: RelativeSpatial,
    occlusion: OcclusionResult,
    facingCos: number,
    mixL: Float32Array,
    mixR: Float32Array,
    mixOffset: number,
    roomBus: Float32Array,
    roomOffset: number,
  ): void {
    const sr = this.sampleRate;
    const tr = this.track;
    const post = this.postScratch;
    readMono(post, n);

    // ---- 距离模型：反距离衰减 + 最大距离淡出 ----
    const d = Math.max(spatial.distance, tr.minDistance);
    let distanceGain = tr.minDistance / d;
    const fadeZone = Math.max(0.5, tr.maxDistance * 0.15);
    const farFade = 1 - smoothstep(tr.maxDistance - fadeZone, tr.maxDistance, spatial.distance);
    distanceGain *= farFade;

    // ---- 空气吸声：高频随距离滚动衰减 ----
    const airCutoff = Math.min(21000, 16000 * Math.exp(-0.045 * Math.max(0, d - 1)));
    setCutoff(this.airPole, airCutoff, sr);

    // ---- 语音指向性：背对听者高频衰减 ----
    let dirCutoff = 21000;
    if (tr.type === 'voice' && tr.directivity > 0) {
      const away = smoothstep(-0.2, -1, facingCos); // 背对比例 0..1
      dirCutoff = 21000 - tr.directivity * away * 15500;
    }
    setCutoff(this.dirPole, dirCutoff, sr);

    // ---- 穿墙：等效低通 + 电平损耗 ----
    setCutoff(this.occPole, occlusion.cutoff, sr);
    const occlusionGain = dbToGain(-occlusion.lossDb);

    // 目标总增益，做块间平滑（淡入淡出与移动都不会爆音）
    const targetGain = this.baseGain * distanceGain * occlusionGain;
    this.gainSmoothed += (targetGain - this.gainSmoothed) * 0.12;

    // ---- 单遍融合：增益 → 三个一阶低通级联 ----
    const g = this.gainSmoothed;
    const dp = this.dirPole;
    const op = this.occPole;
    const ap = this.airPole;
    let zDir = dp.z;
    let zOcc = op.z;
    let zAir = ap.z;
    const sendFactor = 0.16 + 0.5 * smoothstep(1, tr.maxDistance, spatial.distance);

    for (let i = 0; i < n; i++) {
      const x0 = post[i]! * g;
      zDir = dp.b0 * x0 + dp.a1 * zDir;
      zOcc = op.b0 * zDir + op.a1 * zOcc;
      zAir = ap.b0 * zOcc + ap.a1 * zAir;
      // FTZ：防止长时静音/弱信号下 IIR 状态落入 denormal 区
      if (Math.abs(zAir) < 1e-15) {
        zDir = 0;
        zOcc = 0;
        zAir = 0;
      }
      post[i] = zAir;
      roomBus[roomOffset + i]! += zAir * sendFactor;
    }
    dp.z = zDir;
    op.z = zOcc;
    ap.z = zAir;

    // ---- HRTF 双耳渲染 ----
    const hp: HrtfParams = {
      azimuth: spatial.azimuth,
      elevation: spatial.elevation,
      distance: spatial.distance,
    };
    this.hrtf.update(hp, sr);
    const oL = this.outL;
    const oR = this.outR;
    this.hrtf.process(post, oL, oR, n);
    for (let i = 0; i < n; i++) {
      mixL[mixOffset + i]! += oL[i]!;
      mixR[mixOffset + i]! += oR[i]!;
    }
  }
}
