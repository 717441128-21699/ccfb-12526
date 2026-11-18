/** 音频素材库：解码后的 AudioBuffer 按 id 存放 */
export class AudioStore {
  private buffers = new Map<string, AudioBuffer>();

  set(id: string, buf: AudioBuffer): void { this.buffers.set(id, buf); }
  get(id: string | null): AudioBuffer | null {
    return id ? this.buffers.get(id) ?? null : null;
  }
  async loadFile(ctx: BaseAudioContext, id: string, file: File): Promise<void> {
    const raw = await file.arrayBuffer();
    const buf = await ctx.decodeAudioData(raw);
    this.set(id, buf);
  }
}

/**
 * 演示音源：没有真实干声时也能立刻听到方位效果。
 * 每个角色一段不同基频的"咿呀"音节序列，环境声是滤波噪声循环。
 */
export function makeDemoBuffer(ctx: BaseAudioContext, kind: 'voice' | 'ambience', pitch: number): AudioBuffer {
  const sr = ctx.sampleRate;
  if (kind === 'ambience') {
    const len = 4 * sr;
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let lp = 0;
    let s = 12345;
    for (let i = 0; i < len; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      const n = s / 0xffffffff * 2 - 1;
      lp = lp * 0.98 + n * 0.02; // 很低的低通：风声/环境底噪
      d[i] = lp * 2.5;
    }
    return buf;
  }
  // 语音样：基频 + 三个共振峰，按音节断续
  const len = 2 * sr;
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const syllable = 0.28, gap = 0.12;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const cyc = t % (syllable + gap);
    if (cyc > syllable) { d[i] = 0; continue; }
    const env = Math.sin(Math.PI * cyc / syllable) ** 2;
    const f0 = pitch * (1 + 0.06 * Math.sin(2 * Math.PI * 3 * t));
    const ph = 2 * Math.PI * f0 * t;
    let v = Math.sin(ph) * 0.5;
    for (const [fm, g] of [[700, 0.5], [1220, 0.3], [2600, 0.15]] as const) {
      v += g * Math.sin(2 * Math.PI * fm * t) * Math.abs(Math.sin(ph / 2));
    }
    d[i] = v * env * 0.35;
  }
  return buf;
}
