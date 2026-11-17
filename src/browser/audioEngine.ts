import type { Project } from '../core/types.js';
import type { WorkletMessage } from './binaural-worklet.js';

/**
 * 实时音频引擎：AudioContext + AudioWorkletNode 封装。
 * 素材解码为单声道 Float32 后 transfer 给 worklet（零拷贝）。
 * 与离线渲染共用 BinauralRenderer，监听结果即导出结果。
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private buffers = new Map<string, { data: Float32Array; sampleRate: number }>();
  playheadCb: (t: number) => void = () => {};

  /** 解码用户选择的音频文件为单声道 PCM */
  async decodeFile(file: File, targetSampleRate: number): Promise<{ data: Float32Array; sampleRate: number }> {
    const ctx = this.ensureContext();
    const arr = await file.arrayBuffer();
    const audio = await ctx.decodeAudioData(arr);
    if (audio.sampleRate !== targetSampleRate) {
      // 简单线性重采样到工程采样率
      const ratio = audio.sampleRate / targetSampleRate;
      const outLen = Math.floor(audio.length / ratio);
      const out = new Float32Array(outLen);
      const ch0 = audio.getChannelData(0);
      const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
      for (let i = 0; i < outLen; i++) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const a = (ch0[i0] ?? 0) + (ch1 ? ch1[i0] ?? 0 : 0);
        const b = (ch0[i0 + 1] ?? 0) + (ch1 ? ch1[i0 + 1] ?? 0 : 0);
        out[i] = (a + (b - a) * frac) / (ch1 ? 2 : 1);
      }
      return { data: out, sampleRate: targetSampleRate };
    }
    // 下混多声道
    const ch0 = audio.getChannelData(0);
    if (audio.numberOfChannels === 1) return { data: ch0.slice(), sampleRate: audio.sampleRate };
    const mixed = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < mixed.length; i++) mixed[i]! += ch[i]! / audio.numberOfChannels;
    }
    return { data: mixed, sampleRate: audio.sampleRate };
  }

  addBuffer(id: string, data: Float32Array, sampleRate: number): void {
    this.buffers.set(id, { data, sampleRate });
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  async load(project: Project, workletUrl: string): Promise<void> {
    const ctx = this.ensureContext();
    if (!this.node) {
      await ctx.audioWorklet.addModule(workletUrl);
      this.node = new AudioWorkletNode(ctx, 'binaural-worklet', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.node.connect(ctx.destination);
      this.node.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'playhead') this.playheadCb(e.data.time as number);
      };
    }
    const buffers = [...this.buffers.entries()].map(([id, b]) => ({ id, data: b.data, sampleRate: b.sampleRate }));
    this.post({ type: 'load', project, buffers, startTime: 0 });
  }

  async resume(): Promise<void> {
    await this.ensureContext().resume();
  }

  play(): void {
    this.post({ type: 'play' });
  }
  pause(): void {
    this.post({ type: 'pause' });
  }
  seek(time: number, playing: boolean): void {
    this.post({ type: 'seek', time, playing });
  }
  setMuted(ids: string[]): void {
    this.post({ type: 'setMuted', ids });
  }
  setSolo(id: string | null): void {
    this.post({ type: 'setSolo', id });
  }

  get sampleRate(): number {
    return this.ensureContext().sampleRate;
  }

  private post(msg: WorkletMessage): void {
    this.node?.port.postMessage(msg);
  }
}
