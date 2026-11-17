/** 音频 DSP 基础元件：双二阶、一阶低通、分数延迟（均为逐块 in-place 友好实现） */

/** 音频 DSP 通用：非规格化浮点数冲刷阈值（FTZ/DAZ，避免 denormal 导致数量级减速） */
export const DENORMAL_FLUSH = 1e-15;

export class OnePoleLowpass {
  private a1 = 0;
  private b0 = 1;
  private z1 = 0;
  private cutoff = -1;

  /** 平滑设置截止频率，cutoff<=0 表示直通 */
  setCutoff(cutoff: number, sampleRate: number): void {
    if (cutoff === this.cutoff) return;
    this.cutoff = cutoff;
    if (cutoff <= 0 || cutoff >= sampleRate * 0.499) {
      this.a1 = 0;
      this.b0 = 1;
      return;
    }
    const x = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    this.a1 = x;
    this.b0 = 1 - x;
  }

  processBlock(inp: Float32Array, out: Float32Array, n: number): void {
    let z = this.z1;
    const b0 = this.b0;
    const a1 = this.a1;
    for (let i = 0; i < n; i++) {
      z = b0 * inp[i]! + a1 * z;
      if (Math.abs(z) < DENORMAL_FLUSH) z = 0;
      out[i] = z;
    }
    this.z1 = z;
  }

  reset(): void {
    this.z1 = 0;
  }
}

/** RBJ Cookbook 双二阶，当前使用 lowpass / highpass */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  lowpass(fc: number, sampleRate: number, q = 0.707): void {
    const w = (2 * Math.PI * fc) / sampleRate;
    const cosw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = (1 - cosw) / 2 / a0;
    this.b1 = (1 - cosw) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cosw) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  highpass(fc: number, sampleRate: number, q = 0.707): void {
    const w = (2 * Math.PI * fc) / sampleRate;
    const cosw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = (1 + cosw) / 2 / a0;
    this.b1 = -(1 + cosw) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cosw) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  processBlock(inp: Float32Array, out: Float32Array, n: number): void {
    let x1 = this.x1;
    let x2 = this.x2;
    let y1 = this.y1;
    let y2 = this.y2;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < n; i++) {
      const x = inp[i]!;
      let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      if (Math.abs(y) < DENORMAL_FLUSH) y = 0;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
    this.x1 = x1;
    this.x2 = x2;
    this.y1 = y1;
    this.y2 = y2;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/**
 * 分数延迟线（三次拉格朗日插值）。
 * 用于 ITD（亚采样精度）与耳廓反射延迟。
 * 容量取 2 的幂，索引使用位掩码 —— 热路径零取模运算。
 */
export class FractionalDelay {
  readonly buf: Float32Array;
  readonly mask: number;
  idx = 0;

  constructor(maxDelaySamples: number) {
    // 三次插值需要回看 3 个样本，额外余量；容量向上取整到 2 的幂
    const need = Math.max(8, Math.ceil(maxDelaySamples) + 4);
    let cap = 8;
    while (cap < need) cap <<= 1;
    this.buf = new Float32Array(cap);
    this.mask = cap - 1;
  }

  reset(): void {
    this.buf.fill(0);
    this.idx = 0;
  }

  /** 写入一个样本 */
  push(x: number): void {
    this.buf[this.idx] = x;
    this.idx = (this.idx + 1) & this.mask;
  }

  /**
   * 读取延迟 d 个样本前的值（d>=2，含分数部分）。
   * 读取不改变写指针，可在同一块中对同一条延迟线多次取不同延迟。
   */
  read(d: number): number {
    const buf = this.buf;
    const mask = this.mask;
    const fl = Math.floor(d);
    const base = this.idx - 1 - fl;
    const f = d - fl;
    const x0 = buf[(base + 1) & mask]!;
    const x1 = buf[base & mask]!;
    const x2 = buf[(base - 1) & mask]!;
    const x3 = buf[(base - 2) & mask]!;
    // 三次拉格朗日（Horner 形式，减少乘法）
    return (
      x1 +
      0.5 * f * (x2 - x0 + f * (2 * x0 - 5 * x1 + 4 * x2 - x3 + f * (3 * (x1 - x2) + x3 - x0)))
    );
  }
}

/** 块级分数延迟：先整块写入，再按固定延迟整块读出 */
export class BlockFractionalDelay {
  private line: FractionalDelay;
  private block: Float32Array;

  constructor(maxDelaySamples: number, blockSize: number) {
    this.line = new FractionalDelay(maxDelaySamples);
    this.block = new Float32Array(blockSize);
  }

  reset(): void {
    this.line.reset();
  }

  process(inp: Float32Array, out: Float32Array, n: number, delaySamples: number): void {
    const b = this.block;
    for (let i = 0; i < n; i++) {
      this.line.push(inp[i]!);
      b[i] = this.line.read(delaySamples);
    }
    out.set(b.subarray(0, n));
  }
}
