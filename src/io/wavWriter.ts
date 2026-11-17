import { openSync, writeSync, closeSync, ftruncateSync } from 'node:fs';

/**
 * 分块立体声 PCM WAV 写入器。
 * 渲染多少写多少，不缓存整条 40 分钟输出；通过回写头部长度字段完成 RIFF 封装。
 */
export class WavWriter {
  private fd: number;
  private readonly sampleRate: number;
  private dataBytes = 0;
  private readonly bytesPerSample: number;

  constructor(path: string, sampleRate: number, bitsPerSample: 16 | 24 | 32 = 24) {
    this.fd = openSync(path, 'w');
    this.sampleRate = sampleRate;
    this.bytesPerSample = bitsPerSample / 8;
    this.writeHeader(0);
  }

  private writeHeader(dataLength: number): void {
    const channels = 2;
    const blockAlign = channels * this.bytesPerSample;
    const byteRate = this.sampleRate * blockAlign;
    const h = Buffer.alloc(44);
    h.write('RIFF', 0);
    h.writeUInt32LE(36 + dataLength, 4);
    h.write('WAVE', 8);
    h.write('fmt ', 12);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); // PCM
    h.writeUInt16LE(channels, 22);
    h.writeUInt32LE(this.sampleRate, 24);
    h.writeUInt32LE(byteRate, 28);
    h.writeUInt16LE(blockAlign, 32);
    h.writeUInt16LE(this.bytesPerSample * 8, 34);
    h.write('data', 36);
    h.writeUInt32LE(dataLength, 40);
    writeSync(this.fd, h, 0, h.length, 0);
  }

  /** 写入交错立体声 Float32 块，自动限幅并按目标位深量化 */
  writeStereo(left: Float32Array, right: Float32Array): void {
    const n = left.length;
    const bps = this.bytesPerSample;
    const buf = Buffer.alloc(n * 2 * bps);
    let p = 0;
    for (let i = 0; i < n; i++) {
      p = this.encode(buf, p, left[i]!);
      p = this.encode(buf, p, right[i]!);
    }
    // 显式定位到数据区尾部，避免回写头部后文件偏移错乱
    writeSync(this.fd, buf, 0, buf.length, 44 + this.dataBytes);
    this.dataBytes += buf.length;
  }

  private encode(buf: Buffer, pos: number, sample: number): number {
    const v = Math.max(-1, Math.min(1, sample));
    switch (this.bytesPerSample) {
      case 2:
        buf.writeInt16LE(Math.round(v * 32767), pos);
        return pos + 2;
      case 3: {
        // 有符号 24-bit 二补码，范围 -8388608..8388607
        let q = Math.round(v * 8388607);
        if (q < 0) q += 0x1000000; // 转无符号二补码表示
        buf.writeUInt8(q & 0xff, pos);
        buf.writeUInt8((q >> 8) & 0xff, pos + 1);
        buf.writeUInt8((q >> 16) & 0xff, pos + 2);
        return pos + 3;
      }
      case 4:
        buf.writeInt32LE(Math.round(v * 2147483647), pos);
        return pos + 4;
      default:
        throw new Error('不支持的位深');
    }
  }

  close(): void {
    // 回写真实长度，并把文件精确截断到 44 字节头 + 数据长度
    this.writeHeader(this.dataBytes);
    ftruncateSync(this.fd, 44 + this.dataBytes);
    closeSync(this.fd);
  }
}
