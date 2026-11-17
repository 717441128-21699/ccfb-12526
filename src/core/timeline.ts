import {
  equalPower,
  pointInPolygon,
  KeyframeSampler,
} from './mathUtils.js';
import type {
  ListenerState,
  Project,
  Room,
  SourceTrack,
  Vec2,
} from './types.js';

export interface SampledSource {
  track: SourceTrack;
  pos: Vec2;
  active: boolean;
}

export interface RoomMix {
  roomA: Room;
  gainA: number;
  roomB: Room | null;
  gainB: number;
}

const OUTDOOR_FALLBACK: Room = {
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

/**
 * 逐时间块采样工程：听者位姿、各声源位置/激活态、当前房间混响（含 A/B 交叉淡化）。
 * 关键帧查找使用游标采样器，顺序渲染时 O(1) 摊销；seek 后需调用 seek() 重置。
 */
export class SceneSampler {
  private project: Project;
  private roomA: Room;
  private roomB: Room | null = null;
  private fadePos = 1; // 0→1，1 表示淡化结束
  private fadeDur = 1;
  private listenerSampler: KeyframeSampler;
  private sourceSamplers = new Map<string, KeyframeSampler>();
  // 复用返回对象，避免逐子块分配
  private listenerState: ListenerState = { pos: { x: 0, y: 0 }, yaw: 0, pitch: 0 };
  private sampled: SampledSource[];

  constructor(project: Project) {
    this.project = project;
    this.roomA = project.rooms[0] ?? OUTDOOR_FALLBACK;
    this.listenerSampler = new KeyframeSampler(project.listenerKeys);
    for (const s of project.sources) {
      this.sourceSamplers.set(s.id, new KeyframeSampler(s.keys));
    }
    this.sampled = project.sources.map((track) => ({
      track,
      pos: { x: 0, y: 0 },
      active: false,
    }));
  }

  seek(t: number): void {
    const mix = this.resolveRoomHard(t);
    this.roomA = mix;
    this.roomB = null;
    this.fadePos = 1;
    this.fadeDur = mix.fadeSeconds;
    this.listenerSampler.reset(t);
    for (const sm of this.sourceSamplers.values()) sm.reset(t);
  }

  getListener(t: number): ListenerState {
    const s = this.listenerSampler.sample(t);
    this.listenerState.pos.x = s.x;
    this.listenerState.pos.y = s.y;
    this.listenerState.yaw = s.yaw;
    this.listenerState.pitch = 0;
    return this.listenerState;
  }

  /** 返回内部复用数组，调用方不得跨调用持有 */
  getSources(t: number): SampledSource[] {
    const out = this.sampled;
    for (let i = 0; i < out.length; i++) {
      const item = out[i]!;
      const track = item.track;
      item.active = t >= track.start && t < track.start + track.duration;
      const s = this.sourceSamplers.get(track.id)!.sample(t);
      item.pos.x = s.x;
      item.pos.y = s.y;
    }
    return out;
  }

  /** 当前房间混合；每渲染块调用一次以推进淡化 */
  getRoomMix(t: number, blockSeconds: number): RoomMix {
    const target = this.resolveRoomHard(t);
    if (target.id !== this.roomA.id && (this.roomB === null || target.id !== this.roomB.id)) {
      // 开始新的交叉淡化
      this.roomB = this.roomA;
      this.roomA = target;
      this.fadePos = 0;
      this.fadeDur = Math.max(0.05, target.fadeSeconds);
    }
    if (this.fadePos < 1) {
      this.fadePos = Math.min(1, this.fadePos + blockSeconds / this.fadeDur);
      const [gB, gA] = equalPower(this.fadePos);
      return { roomA: this.roomA, gainA: gA, roomB: this.roomB, gainB: gB };
    }
    return { roomA: this.roomA, gainA: 1, roomB: null, gainB: 0 };
  }

  private resolveRoomHard(t: number): Room {
    const auto = this.project.sceneAutomation;
    if (auto.length > 0) {
      let current = auto[0]!;
      for (const e of auto) {
        if (e.t <= t) current = e;
      }
      return this.project.rooms.find((r) => r.id === current.roomId) ?? this.fallback(t);
    }
    return this.fallback(t);
  }

  private fallback(t: number): Room {
    const l = this.getListener(t).pos;
    for (const room of this.project.rooms) {
      if (room.polygon.length >= 3 && pointInPolygon(l, room.polygon)) return room;
    }
    return OUTDOOR_FALLBACK;
  }
}
