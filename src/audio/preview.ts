import type { Project } from '../model/types';
import { samplePath, sampleHeading } from '../model/geometry';
import { computeSpatialParams } from './spatial';
import { buildSourceChain, applyParams, ReverbBus, type SourceChain } from './chain';
import { makeImpulseResponse } from './ir';
import type { AudioStore } from './store';

/**
 * 实时预览引擎：拖动声源、转头、换场景时立刻能听到。
 * 参数用 setTargetAtTime 平滑，避免拉链噪声。
 */
export class PreviewEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ReverbBus | null = null;
  private chains = new Map<string, SourceChain>();
  private nodes: AudioBufferSourceNode[] = [];
  private raf = 0;
  private playing = false;
  private startCtxTime = 0;
  private startTimeline = 0;
  private currentSceneIdx = -1;

  time = 0; // 当前时间轴位置（秒）

  constructor(private project: Project, private store: AudioStore) {}

  get isPlaying(): boolean { return this.playing; }

  /** 懒建 AudioContext（浏览器要求用户手势后才能出声） */
  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.reverb = new ReverbBus(this.ctx, this.master);
      const span = this.sceneAt(this.time);
      this.reverb.init(makeImpulseResponse(this.ctx, span.preset), span.preset.wet);
      this.currentSceneIdx = this.sceneIndexAt(this.time);
    }
    return this.ctx;
  }

  sceneIndexAt(t: number): number {
    const i = this.project.scenes.findIndex(s => t >= s.start && t < s.end);
    return i < 0 ? this.project.scenes.length - 1 : i;
  }
  private sceneAt(t: number) { return this.project.scenes[this.sceneIndexAt(t)]; }

  play(): void {
    const ctx = this.ensureCtx();
    void ctx.resume();
    this.stopSources();
    this.startCtxTime = ctx.currentTime + 0.05;
    this.startTimeline = this.time;

    for (const src of this.project.sources) {
      const chain = buildSourceChain(ctx, this.master!, this.reverb!.input);
      this.chains.set(src.id, chain);
      const buf = this.store.get(src.bufferId);
      if (buf) {
        const node = ctx.createBufferSource();
        node.buffer = buf;
        node.loop = src.loop;
        node.connect(chain.input);
        const offset = Math.max(0, this.time - src.startTime);
        const when = this.startCtxTime + Math.max(0, src.startTime - this.time);
        if (src.loop) node.start(when, offset % buf.duration);
        else if (offset < buf.duration) node.start(when, offset);
        this.nodes.push(node);
      }
      chain.input.gain.value = src.gain;
    }
    this.playing = true;
    this.tick();
  }

  stop(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopSources();
    this.chains.clear();
  }

  private stopSources(): void {
    for (const n of this.nodes) { try { n.stop(); } catch { /* 已停止 */ } n.disconnect(); }
    this.nodes = [];
  }

  seek(t: number): void {
    this.time = t;
    if (this.playing) { this.stop(); this.play(); }
  }

  /** 每帧：采样轨道 → 算空间参数 → 平滑写入 */
  private tick = (): void => {
    if (!this.playing || !this.ctx) return;
    const ctx = this.ctx;
    this.time = this.startTimeline + (ctx.currentTime - this.startCtxTime);
    if (this.time >= this.project.duration) { this.stop(); this.time = 0; return; }

    // 场景切换：混响乒乓交叉淡化（3 秒）
    const idx = this.sceneIndexAt(this.time);
    if (idx !== this.currentSceneIdx) {
      this.currentSceneIdx = idx;
      const span = this.project.scenes?.[idx] ?? this.project.scenes[idx];
      this.reverb!.scheduleTransition(
        makeImpulseResponse(ctx, span.preset), span.preset.wet, ctx.currentTime, 3,
      );
    }

    const lisPos = samplePath(this.project.listener.path, this.time);
    const lisHead = sampleHeading(this.project.listener.heading, this.time);
    const now = ctx.currentTime;
    for (const src of this.project.sources) {
      const chain = this.chains.get(src.id);
      if (!chain) continue;
      const pos = samplePath(src.path, this.time);
      const p = computeSpatialParams(src, pos, lisPos, lisHead, this.project.walls);
      applyParams(chain, p, now, 0.03);
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** 暂停时（拖动编辑）也更新一帧参数，让静态调整可听 */
  poke(): void {
    if (!this.ctx || this.playing) return;
    const lisPos = samplePath(this.project.listener.path, this.time);
    const lisHead = sampleHeading(this.project.listener.heading, this.time);
    for (const src of this.project.sources) {
      const chain = this.chains.get(src.id);
      if (!chain) continue;
      const pos = samplePath(src.path, this.time);
      applyParams(chain, computeSpatialParams(src, pos, lisPos, lisHead, this.project.walls), this.ctx.currentTime, 0.03);
    }
  }
}
