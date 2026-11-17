import type { AudioSource } from '../io/audioSource.js';

/**
 * 浏览器 AudioBuffer 包装为统一 AudioSource（多声道下混为单声道）。
 * 实时监听与（未来的）浏览器内离线导出共用。
 */
export class BufferAudioSource implements AudioSource {
  readonly id: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: number;
  private buffer: AudioBuffer;

  constructor(id: string, buffer: AudioBuffer) {
    this.id = id;
    this.buffer = buffer;
    this.sampleRate = buffer.sampleRate;
    this.channels = buffer.numberOfChannels;
    this.frames = buffer.length;
  }

  readBlock(frame: number, n: number, out: Float32Array): number {
    const ch = this.channels;
    const chans: Float32Array[] = [];
    for (let c = 0; c < ch; c++) chans.push(this.buffer.getChannelData(c));
    const start = Math.max(0, frame);
    const skip = start - frame;
    for (let i = 0; i < skip; i++) out[i] = 0;
    const valid = Math.min(n - skip, Math.max(0, this.frames - start));
    for (let i = 0; i < valid; i++) {
      let sum = 0;
      for (let c = 0; c < ch; c++) sum += chans[c]![start + i]!;
      out[skip + i] = sum / ch;
    }
    for (let i = skip + valid; i < n; i++) out[i] = 0;
    return n;
  }
}
