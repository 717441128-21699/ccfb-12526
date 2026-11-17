import { BinauralRenderer } from '../dsp/renderer.js';
import type { Project } from '../core/types.js';
import type { AudioSource } from '../io/audioSource.js';

/**
 * AudioWorklet 全局处理器。
 * 主线程把工程 JSON + 素材 PCM 端口数据传入，worklet 内实例化
 * 与离线渲染完全相同的 BinauralRenderer，保证"听到即导出"。
 *
 * 实时块固定 128 样本，subBlock 取 128（约 2.7ms 空间分辨率，满足拖动反馈）。
 */
class BinauralWorkletProcessor extends AudioWorkletProcessor {
  private renderer: BinauralRenderer | null = null;
  private sources: AudioSource[] = [];
  private playhead = 0;
  private playing = false;
  private readonly blockSize = 128;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => this.handleMessage(e.data);
  }

  private handleMessage(msg: WorkletMessage): void {
    switch (msg.type) {
      case 'load': {
        // 素材通过 transfer 的 Float32Array 重建 AudioSource（轻量内联实现）
        this.sources = msg.buffers.map((b) => new InlineBufferSource(b.id, b.data, b.sampleRate));
        const project: Project = msg.project;
        this.renderer = new BinauralRenderer(project, this.sources, this.blockSize, this.blockSize);
        this.playhead = msg.startTime * sampleRate;
        this.renderer.seek(msg.startTime);
        break;
      }
      case 'play':
        this.playing = true;
        break;
      case 'pause':
        this.playing = false;
        break;
      case 'seek': {
        this.playhead = msg.time * sampleRate;
        this.renderer?.seek(msg.time);
        this.playing = msg.playing ?? this.playing;
        break;
      }
      case 'setMuted':
        this.renderer!.muted = new Set(msg.ids);
        break;
      case 'setSolo':
        this.renderer!.solo = msg.id;
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]!;
    const outL = out[0]!;
    const outR = out[1] ?? out[0]!;
    if (this.renderer && this.playing) {
      const t = this.playhead / sampleRate;
      const { left, right } = this.renderer.renderBlock(t);
      outL.set(left.subarray(0, this.blockSize));
      outR.set(right.subarray(0, this.blockSize));
      this.playhead += this.blockSize;
      this.port.postMessage({ type: 'playhead', time: this.playhead / sampleRate });
    } else {
      outL.fill(0);
      outR.fill(0);
    }
    return true;
  }
}

/** worklet 内不能依赖 DOM AudioBuffer，直接用 transfer 来的 Float32Array */
class InlineBufferSource implements AudioSource {
  readonly id: string;
  readonly sampleRate: number;
  readonly channels = 1;
  readonly frames: number;
  constructor(id: string, private data: Float32Array, sampleRate: number) {
    this.id = id;
    this.sampleRate = sampleRate;
    this.frames = data.length;
  }
  readBlock(frame: number, n: number, out: Float32Array): number {
    const start = Math.max(0, frame);
    const skip = start - frame;
    for (let i = 0; i < skip; i++) out[i] = 0;
    const valid = Math.min(n - skip, Math.max(0, this.frames - start));
    for (let i = 0; i < valid; i++) out[skip + i] = this.data[start + i]!;
    for (let i = skip + valid; i < n; i++) out[i] = 0;
    return n;
  }
}

export type WorkletMessage =
  | { type: 'load'; project: Project; buffers: { id: string; data: Float32Array; sampleRate: number }[]; startTime: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number; playing?: boolean }
  | { type: 'setMuted'; ids: string[] }
  | { type: 'setSolo'; id: string | null };

registerProcessor('binaural-worklet', BinauralWorkletProcessor);
