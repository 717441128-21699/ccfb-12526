import { BlockFractionalDelay, FractionalDelay, OnePoleLowpass } from './filters.js';
import { sinDeg } from '../core/geometry.js';
import { clamp, degToRad } from '../core/mathUtils.js';

/**
 * 参数化 HRTF（每耳独立），提供四类空间线索：
 *  1. ITD 双耳时间差（Woodworth 球面模型 + 近场修正）—— 左右定位主线索
 *  2. 头部声影 ILD：远耳低通衰减（对侧耳高频被头挡住）
 *  3. 耳廓反射陷波：延迟与增益随仰角/前后变化 —— 前后判别主线索
 *  4. 近场增益：极近距离的逐耳距离差带来的响度差
 *
 * 这是一个轻量合成模型（无需外部 SOFA/HRIR 数据），接口设计上可与
 * MeasuredHrtf（分块卷积实测 HRIR）互换。
 */

const HEAD_RADIUS = 0.0875; // 米，成人头等效半径
const SPEED_OF_SOUND = 343;
const MIN_DELAY = 2; // 分数延迟线最小可读延迟（插值要求）

export interface HrtfParams {
  /** 头部坐标系方位角，度，0=正前 +90=右 ±180=正后 */
  azimuth: number;
  /** 仰角，度 */
  elevation: number;
  /** 源到头部中心距离（米） */
  distance: number;
}

class EarChannel {
  readonly itd: BlockFractionalDelay;
  readonly shadow: OnePoleLowpass;
  private readonly pinnaLine: FractionalDelay;
  private pinnaDelaySamples = MIN_DELAY;
  private pinnaGain = 0.12;
  private nearGain = 1;

  constructor(sampleRate: number, blockSize: number) {
    const maxItd = Math.ceil(((2 * HEAD_RADIUS) / SPEED_OF_SOUND) * sampleRate) + 4;
    this.itd = new BlockFractionalDelay(maxItd, blockSize);
    this.shadow = new OnePoleLowpass();
    // 耳廓反射延迟 0.05–0.4ms
    this.pinnaLine = new FractionalDelay(Math.ceil(0.00045 * sampleRate) + 4);
  }

  /**
   * @param side       -1 左耳 / +1 右耳
   * @param lateral    该耳相对声源的侧向系数（对侧=+1 声影最重，同侧=-1）
   * @param backFactor 0=正前 1=正后
   */
  update(
    p: HrtfParams,
    side: -1 | 1,
    lateral: number,
    backFactor: number,
    sinAz: number,
    cosAz: number,
    sampleRate: number,
  ): void {
    const absAz = Math.abs(degToRad(p.azimuth));
    // ---- ITD：Woodworth 全量双耳时间差 + 近场分量 ----
    // 同侧耳取最小基准延迟，对侧耳在其基础上增加完整 ITD，保证双耳相对差即物理 ITD
    const farField = (HEAD_RADIUS / SPEED_OF_SOUND) * (absAz + Math.sin(absAz));
    const nearFactor = clamp(HEAD_RADIUS / Math.max(p.distance, HEAD_RADIUS), 0, 1);
    const itdSeconds = farField * (1 + 0.35 * nearFactor * Math.sin(absAz));
    // lateral: 该耳处于对侧(=1)时承担全部 ITD；同侧(=0)为基准
    const delay = MIN_DELAY + lateral * itdSeconds * sampleRate;
    this.itdDelay = delay;

    // ---- 头部声影：对侧耳低通 ----
    const shadowWeight = clamp(lateral, 0, 1);
    const cutoff = 21000 - 17500 * shadowWeight; // 同侧 21k 直通，对侧 ~3.5k
    this.shadow.setCutoff(cutoff, sampleRate);

    // ---- 耳廓反射：后方反射路径更长、陷波更深 ----
    const pinnaSeconds = 0.0001 + 0.00018 * (backFactor + 0.5 * Math.max(0, sinDeg(p.elevation)));
    this.pinnaDelaySamples = MIN_DELAY + pinnaSeconds * sampleRate;
    this.pinnaGain = 0.1 + 0.22 * backFactor - 0.05 * Math.abs(degToRad(p.elevation));
    // 预计算三次插值权重（分数部分在整个子块内不变）
    const pd = this.pinnaDelaySamples;
    this.pinnaIntDelay = Math.floor(pd);
    const f = pd - this.pinnaIntDelay;
    this.pinnaW0 = 0.5 * f * (-1 + f * (2 - f));
    this.pinnaW1 = 1 + 0.5 * f * f * (-5 + f * (3 + 2 * f));
    this.pinnaW2 = 0.5 * f * (2 + f * (4 - 3 * f));
    this.pinnaW3 = 0.5 * f * f * (-1 + f);

    // ---- 近场逐耳距离差（复用已算好的 sin/cos）----
    const earOffset = HEAD_RADIUS * side * sinAz * 1;
    const earDist = Math.max(0.05, p.distance - earOffset);
    this.nearGain = clamp(p.distance / earDist, 0.85, 1.18);
    void cosAz;
  }

  private itdDelay = MIN_DELAY;

  private pinnaW0 = 0;
  private pinnaW1 = 0;
  private pinnaW2 = 0;
  private pinnaW3 = 0;
  private pinnaIntDelay = 0;

  process(inp: Float32Array, out: Float32Array, n: number): void {
    this.itd.process(inp, out, n, this.itdDelay);
    this.shadow.processBlock(out, out, n);
    const pg = this.pinnaGain;
    const line = this.pinnaLine;
    const ng = this.nearGain;
    // 延迟在块内恒定：插值权重预算一次，热循环只做 4 次位掩码取数
    const w0 = this.pinnaW0;
    const w1 = this.pinnaW1;
    const w2 = this.pinnaW2;
    const w3 = this.pinnaW3;
    const intD = this.pinnaIntDelay;
    const mask = line.mask;
    const buf = line.buf;
    let idx = line.idx;
    for (let i = 0; i < n; i++) {
      const x = out[i]!;
      buf[idx] = x;
      idx = (idx + 1) & mask;
      const base = idx - 1 - intD;
      const delayed =
        buf[(base + 1) & mask]! * w0 +
        buf[base & mask]! * w1 +
        buf[(base - 1) & mask]! * w2 +
        buf[(base - 2) & mask]! * w3;
      // 直达 + 延迟反射相消形成陷波（前后/仰角着色）
      out[i] = ng * (x - pg * delayed);
    }
    line.idx = idx;
  }

  reset(): void {
    this.itd.reset();
    this.shadow.reset();
    this.pinnaLine.reset();
  }
}

export class ParametricHrtf {
  private left: EarChannel;
  private right: EarChannel;

  constructor(sampleRate: number, blockSize: number) {
    this.left = new EarChannel(sampleRate, blockSize);
    this.right = new EarChannel(sampleRate, blockSize);
  }

  update(p: HrtfParams, sampleRate: number): void {
    const azRad = degToRad(p.azimuth);
    const sinAz = Math.sin(azRad);
    const cosAz = Math.cos(azRad);
    const back = clamp((1 - cosAz) / 2, 0, 1); // 正前 0 → 正后 1
    // 左耳对侧程度：声源在右侧(sinAz>0)时左耳进入声影
    this.left.update(p, -1, clamp(sinAz, 0, 1), back, sinAz, cosAz, sampleRate);
    this.right.update(p, 1, clamp(-sinAz, 0, 1), back, sinAz, cosAz, sampleRate);
  }

  process(inp: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void {
    this.left.process(inp, outL, n);
    this.right.process(inp, outR, n);
  }

  reset(): void {
    this.left.reset();
    this.right.reset();
  }
}
