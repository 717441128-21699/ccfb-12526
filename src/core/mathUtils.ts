import type { Keyframe, Vec2 } from './types.js';

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/** 等功率交叉淡化曲线（余弦），u∈[0,1]，返回 [aGain, bGain]，平方和为 1 */
export function equalPower(u: number): [number, number] {
  const a = Math.cos(u * Math.PI * 0.5);
  const b = Math.sin(u * Math.PI * 0.5);
  return [a, b];
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 角度包装到 (-180, 180] */
export function wrapDeg(a: number): number {
  let r = ((a + 180) % 360 + 360) % 360 - 180;
  if (r === -180) r = 180;
  return r;
}

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/**
 * 关键帧采样：分段线性。关键帧外按首尾值钳位（保证静止段）。
 * keys 必须按 t 升序。
 */
export function sampleKeys(keys: Keyframe[], t: number): { x: number; y: number; yaw: number } {
  if (keys.length === 0) return { x: 0, y: 0, yaw: 0 };
  const first = keys[0]!;
  if (t <= first.t) return { x: first.x, y: first.y, yaw: first.yaw ?? 0 };
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return { x: last.x, y: last.y, yaw: last.yaw ?? 0 };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return {
        x: lerp(a.x, b.x, u),
        y: lerp(a.y, b.y, u),
        yaw: lerp(a.yaw ?? 0, b.yaw ?? 0, u),
      };
    }
  }
  return { x: last.x, y: last.y, yaw: last.yaw ?? 0 };
}

/**
 * 有游标的关键帧采样器：时间轴顺序访问时保持 O(1) 摊销。
 * 每个（听者/声源）采样器实例对应一条关键帧轨道，seek 后调用 reset()。
 */
export class KeyframeSampler {
  private seg = 0;
  constructor(private keys: Keyframe[]) {}

  reset(t: number): void {
    this.seg = 0;
    // 二分定位到初始段，seek 后一次 O(log n)
    let lo = 0;
    let hi = this.keys.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.keys[mid + 1]!.t <= t) lo = mid + 1;
      else hi = mid;
    }
    this.seg = Math.min(lo, Math.max(0, this.keys.length - 2));
  }

  sample(t: number): { x: number; y: number; yaw: number } {
    const keys = this.keys;
    if (keys.length === 0) return { x: 0, y: 0, yaw: 0 };
    const first = keys[0]!;
    if (t <= first.t) return { x: first.x, y: first.y, yaw: first.yaw ?? 0 };
    const last = keys[keys.length - 1]!;
    if (t >= last.t) return { x: last.x, y: last.y, yaw: last.yaw ?? 0 };
    // 顺序推进游标（渲染中 t 单调递增，通常零次循环）
    while (this.seg < keys.length - 2 && t > keys[this.seg + 1]!.t) this.seg++;
    while (this.seg > 0 && t < keys[this.seg]!.t) this.seg--;
    const a = keys[this.seg]!;
    const b = keys[this.seg + 1]!;
    const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), yaw: lerp(a.yaw ?? 0, b.yaw ?? 0, u) };
  }
}

/** 线段相交（含端点） */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (d === 0) return false;
  const u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

/** 点到线段的最近点与距离 */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return dist(p, a);
  let u = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  u = clamp(u, 0, 1);
  return Math.hypot(p.x - (a.x + abx * u), p.y - (a.y + aby * u));
}

/** 射线法判定点是否在多边形内 */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    const intersect =
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}
