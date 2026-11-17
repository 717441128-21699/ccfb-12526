import { SceneSampler } from '../core/timeline.js';
import { relativeSpatial } from '../core/geometry.js';
import { evaluateOcclusion } from '../core/occlusion.js';
import { clamp } from '../core/mathUtils.js';
import { RoomEngine } from './room.js';
import { SourceProcessor } from './sourceProcessor.js';
import type { AudioSource } from '../io/audioSource.js';
import type { Project, Room, SourceTrack } from '../core/types.js';

export const SUB_BLOCK = 64;
const TAIL_THRESHOLD = 1e-6;

/**
 * 双耳渲染器（离线与 AudioWorklet 实时共用）。
 * 渲染粒度为块（blockSize，须为 subBlock 的整数倍），块内逐 subBlock 更新
 * 几何/HRTF/滤波器系数。离线用 64（约 1.3ms 空间分辨率），实时端可传 128。
 * 调用方按时间顺序喂块；跳转时间轴必须 seek()。
 */
export class BinauralRenderer {
  readonly sampleRate: number;
  private project: Project;
  private sampler: SceneSampler;
  private processors = new Map<string, SourceProcessor>();
  private sources = new Map<string, AudioSource>();
  private roomA: RoomEngine;
  private roomB: RoomEngine | null = null;
  private blockSize: number;
  private subBlock: number;
  private subBlocks: number;
  private roomBusA: Float32Array;
  private roomBusB: Float32Array;
  private wetL: Float32Array;
  private wetR: Float32Array;
  private blockL: Float32Array;
  private blockR: Float32Array;
  muted = new Set<string>();
  solo: string | null = null;
  /** 非活动轨的混响尾巴状态：1=刚停止有尾巴，0=尾巴已尽彻底关闭 */
  private tails = new Map<string, number>();

  constructor(project: Project, sources: AudioSource[], blockSize = 1024, subBlock = SUB_BLOCK) {
    if (blockSize % subBlock !== 0) throw new Error('blockSize 必须是 subBlock 的整数倍');
    this.project = project;
    this.sampleRate = project.sampleRate;
    this.blockSize = blockSize;
    this.subBlock = subBlock;
    this.subBlocks = blockSize / subBlock;
    this.sampler = new SceneSampler(project);
    for (const s of sources) this.sources.set(s.id, s);
    for (const track of project.sources) {
      this.processors.set(track.id, new SourceProcessor(track, project.sampleRate, subBlock));
    }
    this.roomA = new RoomEngine(project.rooms[0] ?? this.implicitOutdoor(), project.sampleRate);
    this.roomBusA = new Float32Array(blockSize);
    this.roomBusB = new Float32Array(blockSize);
    this.wetL = new Float32Array(blockSize);
    this.wetR = new Float32Array(blockSize);
    this.blockL = new Float32Array(blockSize);
    this.blockR = new Float32Array(blockSize);
  }

  private implicitOutdoor(): Room {
    return {
      id: '__implicit_outdoor__',
      name: '室外（默认）',
      kind: 'outdoor',
      polygon: [],
      rt60: 0.18,
      roomSize: 30,
      levelDb: -26,
      hfDamping: 0.15,
      fadeSeconds: 1.2,
    };
  }

  seek(timeSeconds: number): void {
    this.sampler.seek(timeSeconds);
    for (const p of this.processors.values()) p.reset();
    this.roomA = new RoomEngine(this.roomA.room, this.sampleRate);
    this.roomB = null;
    this.tails.clear();
  }

  /**
   * 渲染从 timeSeconds 开始的一个块。
   * @returns 左右耳各 blockSize 个样本（内部缓冲，下次调用失效）
   */
  renderBlock(timeSeconds: number): { left: Float32Array; right: Float32Array } {
    const n = this.blockSize;
    const sr = this.sampleRate;
    const mixL = this.blockL;
    const mixR = this.blockR;
    const busA = this.roomBusA;
    const busB = this.roomBusB;
    mixL.fill(0);
    mixR.fill(0);
    busA.fill(0);
    busB.fill(0);

    const blockSeconds = n / sr;
    const roomMix = this.sampler.getRoomMix(timeSeconds, blockSeconds);
    this.ensureRoomEngines(roomMix.roomA, roomMix.roomB);
    const sub = this.subBlock;

    for (let sb = 0; sb < this.subBlocks; sb++) {
      const off = sb * sub;
      const tMid = timeSeconds + (off + sub / 2) / sr;
      const listener = this.sampler.getListener(tMid);
      const sampled = this.sampler.getSources(tMid);
      // 房间交叉淡化在一个块内近似恒定（淡化时长秒级，块长毫秒级）
      const gA = roomMix.gainA;
      const gB = roomMix.gainB;
      const hasB = this.roomB !== null && gB > 0;

      for (const item of sampled) {
        const track = item.track;
        if (this.muted.has(track.id)) continue;
        if (this.solo !== null && this.solo !== track.id) continue;
        const proc = this.processors.get(track.id);
        const audio = this.sources.get(track.clipId);
        if (!proc || !audio) continue;

        // ---- 非活动轨：只维持混响尾巴，跳过 HRTF 干声，超阈值后彻底关闭 ----
        if (!item.active) {
          if (this.tails.get(track.id) === 1) {
            const peak = proc.processTail(sub, busA, off);
            if (peak < TAIL_THRESHOLD) this.tails.set(track.id, 0);
            else if (hasB) {
              for (let i = 0; i < sub; i++) {
                const send = busA[off + i]!;
                busB[off + i] = send * gB;
                busA[off + i] = send * gA;
              }
            }
          }
          continue;
        }
        this.tails.set(track.id, 1); // 活动中；转非活动后自然进入尾巴阶段

        const spatial = relativeSpatial(item.pos, listener);
        const occlusion = evaluateOcclusion(item.pos, listener.pos, this.project.occluders);
        const facingCos = this.voiceFacingCos(track, tMid, listener.pos.x, listener.pos.y);

        const clipFrameMid =
          Math.floor((tMid - track.start + track.inPoint) * audio.sampleRate) -
          Math.floor(sub / 2);

        proc.process(
          sub,
          (out, frames) => {
            const converted = Math.round(clipFrameMid * (audio.sampleRate / sr));
            audio.readBlock(converted, frames, out);
          },
          spatial,
          occlusion,
          facingCos,
          mixL,
          mixR,
          off,
          busA,
          off,
        );

        // 房间发送按当前淡化增益拆给 A/B 两个房间引擎
        if (hasB) {
          for (let i = 0; i < sub; i++) {
            const send = busA[off + i]!;
            busB[off + i] = send * gB;
            busA[off + i] = send * gA;
          }
        }
      }
    }

    // ---- 房间引擎：湿声累加到独立缓冲后与干声混合（总线已按 A/B 增益拆分）----
    const wetL = this.wetL;
    const wetR = this.wetR;
    wetL.fill(0);
    wetR.fill(0);
    this.roomA.process(busA, wetL, wetR, n);
    if (this.roomB) this.roomB.process(busB, wetL, wetR, n);
    for (let i = 0; i < n; i++) {
      mixL[i] = softClip(mixL[i]! + wetL[i]!);
      mixR[i] = softClip(mixR[i]! + wetR[i]!);
    }
    return { left: mixL, right: mixR };
  }

  private ensureRoomEngines(a: Room, b: Room | null): void {
    if (this.roomA.room.id !== a.id) {
      this.roomA = new RoomEngine(a, this.sampleRate);
    }
    if (b) {
      if (!this.roomB || this.roomB.room.id !== b.id) {
        this.roomB = new RoomEngine(b, this.sampleRate);
      }
    } else {
      this.roomB = null;
    }
  }

  /**
   * 语音指向性：计算声源"前方"与"源→听者方向"的夹角余弦。
   * 源的前方取其运动路径切线方向；静止源视为全向（返回 1）。
   */
  private voiceFacingCos(track: SourceTrack, t: number, lx: number, ly: number): number {
    const keys = track.keys;
    if (keys.length < 2) return 1;
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1]!.t) i++;
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return 1;
    const fx = dx / len;
    const fy = dy / len;
    const pos = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const tx = lx - pos.x;
    const ty = ly - pos.y;
    const tl = Math.hypot(tx, ty) || 1;
    return clamp((fx * tx + fy * ty) / tl, -1, 1);
  }
}

function softClip(x: number): number {
  const ax = Math.abs(x);
  if (ax <= 0.7) return x;
  // 有理逼近 tanh，避免 Math.tanh 的高开销；误差 <1%，单调对称。
  // 上限收敛到 0.9（再经 -6dB 母带电平），给量化留足 headroom 杜绝满幅削波
  const u = (ax - 0.7) / 0.3;
  return 0.9 * Math.sign(x) * (0.7 + 0.3 * (u / (1 + 0.5 * u)));
}
