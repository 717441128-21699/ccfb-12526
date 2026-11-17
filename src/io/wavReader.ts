import { openSync, readSync, closeSync, statSync } from 'node:fs';
import type { AudioSource } from './audioSource.js';

/**
 * 流式 PCM WAV 读取器（Node）。
 * 支持 PCM 8/16/24/32-bit 与 IEEE float32，多声道按等权下混为单声道。
 * 仅保留一个文件描述符，按 readBlock 随机定位读取 —— 40 分钟素材不全量进内存。
 */
export class WavFileSource implements AudioSource {
  readonly id: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: number;
  private fd: number;
  private bytesPerSample: number;
  private dataOffset: number;
  private isFloat: boolean;
  private fileBytes: number;
  private rawBuf: Buffer = Buffer.alloc(0);

  constructor(id: string, path: string) {
    this.id = id;
    this.fd = openSync(path, 'r');
    this.fileBytes = statSync(path).size;
    const header = Buffer.alloc(12);
    this.readFully(header, 0);
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error(`不是合法 WAV 文件: ${path}`);
    }

    let offset = 12;
    let audioFormat = 1;
    let channels = 1;
    let sampleRate = 48000;
    let bitsPerSample = 16;
    let dataOffset = -1;
    let dataLength = 0;
    const chunkHeader = Buffer.alloc(8);

    while (offset + 8 <= this.fileBytes) {
      this.readFully(chunkHeader, offset);
      const id = chunkHeader.toString('ascii', 0, 4);
      const size = chunkHeader.readUInt32LE(4);
      const body = offset + 8;
      if (id === 'fmt ') {
        const fmt = Buffer.alloc(Math.min(size, 40));
        this.readFully(fmt, body);
        audioFormat = fmt.readUInt16LE(0);
        channels = fmt.readUInt16LE(2);
        sampleRate = fmt.readUInt32LE(4);
        bitsPerSample = fmt.readUInt16LE(14);
      } else if (id === 'data') {
        dataOffset = body;
        dataLength = size;
      }
      offset = body + size + (size % 2); // RIFF 块偶数字节对齐
      if (dataOffset >= 0 && id !== 'fmt ' && id !== 'data') break;
    }

    if (dataOffset < 0) throw new Error(`WAV 缺少 data 块: ${path}`);
    this.channels = channels;
    this.sampleRate = sampleRate;
    this.bytesPerSample = bitsPerSample / 8;
    this.isFloat = audioFormat === 3;
    this.dataOffset = dataOffset;
    const frameBytes = this.bytesPerSample * channels;
    this.frames = Math.floor(dataLength / frameBytes);
  }

  private readFully(buf: Buffer, position: number): void {
    let got = 0;
    while (got < buf.length) {
      const n = readSync(this.fd, buf, got, buf.length - got, position + got);
      if (n <= 0) throw new Error('WAV 读取意外结束');
      got += n;
    }
  }

  readBlock(frame: number, n: number, out: Float32Array): number {
    const frameBytes = this.bytesPerSample * this.channels;
    const startFrame = Math.max(0, frame);
    const skip = startFrame - frame; // 头部静音样本数
    const avail = Math.max(0, this.frames - startFrame);
    const valid = Math.min(n - skip, avail);

    for (let i = 0; i < skip; i++) out[i] = 0;
    if (valid <= 0) {
      for (let i = Math.max(0, skip); i < n; i++) out[i] = 0;
      return n;
    }

    // 复用解码缓冲，避免逐块分配（块大小固定时零 GC）
    const need = valid * frameBytes;
    if (this.rawBuf.length < need) this.rawBuf = Buffer.alloc(need);
    const raw = this.rawBuf.subarray(0, need);
    this.readFully(raw, this.dataOffset + startFrame * frameBytes);
    const ch = this.channels;
    const bps = this.bytesPerSample;

    for (let i = 0; i < valid; i++) {
      let sum = 0;
      for (let c = 0; c < ch; c++) {
        const pos = (i * ch + c) * bps;
        sum += this.decodeSample(raw, pos);
      }
      out[skip + i] = sum / ch;
    }
    for (let i = skip + valid; i < n; i++) out[i] = 0;
    return n;
  }

  private decodeSample(buf: Buffer, pos: number): number {
    if (this.isFloat && this.bytesPerSample === 4) return buf.readFloatLE(pos);
    switch (this.bytesPerSample) {
      case 1:
        return (buf.readUInt8(pos) - 128) / 128;
      case 2:
        return buf.readInt16LE(pos) / 32768;
      case 3: {
        const raw = buf.readIntLE(pos, 3);
        // readIntLE 已按二补码返回有符号整数，归一化到 [-1,1]
        return raw / 8388608;
      }
      case 4:
        return buf.readInt32LE(pos) / 2147483648;
      default:
        return 0;
    }
  }

  close(): void {
    closeSync(this.fd);
  }
}
