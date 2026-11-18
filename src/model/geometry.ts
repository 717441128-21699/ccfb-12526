import type { Keyframe, HeadingKey, Vec2, Wall } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 按时间在线性关键帧轨道上采样位置（两端钳制） */
export function samplePath(path: Keyframe[], t: number): Vec2 {
  if (path.length === 0) return { x: 0, y: 0 };
  if (t <= path[0].time) return { x: path[0].x, y: path[0].y };
  const last = path[path.length - 1];
  if (t >= last.time) return { x: last.x, y: last.y };
  let lo = 0, hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].time <= t) lo = mid; else hi = mid;
  }
  const a = path[lo], b = path[hi];
  const k = (t - a.time) / (b.time - a.time);
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
}

/** 采样朝向轨道（角度按最短弧插值） */
export function sampleHeading(keys: HeadingKey[], t: number): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0].time) return keys[0].angle;
  const last = keys[keys.length - 1];
  if (t >= last.time) return last.angle;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].time <= t) i++;
  const a = keys[i], b = keys[i + 1];
  let d = b.angle - a.angle;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a.angle + d * ((t - a.time) / (b.time - a.time));
}

/** 线段 AB 与 CD 是否相交（用于声源→听者连线的墙体遮挡检测） */
export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

/**
 * 计算声源到听者之间被墙遮挡的程度。
 * 返回 0..1 的"通透度"：1 = 完全无遮挡，每穿过一道墙乘以墙的透射系数。
 */
export function occlusionTransparency(src: Vec2, lis: Vec2, walls: Wall[]): number {
  let t = 1;
  for (const w of walls) {
    if (segmentsIntersect(src.x, src.y, lis.x, lis.y, w.ax, w.ay, w.bx, w.by)) {
      t *= w.transmission;
    }
  }
  return t;
}

/** 角度差折到 [-PI, PI] */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
