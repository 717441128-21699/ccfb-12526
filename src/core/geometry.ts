import { degToRad, radToDeg, wrapDeg } from './mathUtils.js';
import type { ListenerState, Vec2 } from './types.js';

export interface RelativeSpatial {
  /** 米 */
  distance: number;
  /** 头部坐标系方位角，度：0 正前，+90 右侧，±180 正后 */
  azimuth: number;
  /** 仰角，度：0 水平，+90 上方（2D 工程当前恒为 0，接口保留） */
  elevation: number;
  /** 源相对听者的世界坐标向量 */
  rel: Vec2;
}

/**
 * 把世界坐标的源位置换算到听者头部坐标系。
 * 听者转头（yaw 变化）时所有声音方位随之旋转 —— 全部空间化都基于该相对量。
 */
export function relativeSpatial(source: Vec2, listener: ListenerState): RelativeSpatial {
  const dx = source.x - listener.pos.x;
  const dy = source.y - listener.pos.y;
  const distance = Math.hypot(dx, dy) || 1e-6;
  const worldAngle = radToDeg(Math.atan2(dy, dx));
  const azimuth = wrapDeg(worldAngle - listener.yaw);
  // 2D 俯视图没有高度；pitch 接口保留，未来加入 z 坐标后直接生效
  const elevation = -listener.pitch;
  return { distance, azimuth, elevation, rel: { x: dx, y: dy } };
}

/** 正弦余弦（角度入参），避免重复转换 */
export function sinDeg(deg: number): number {
  return Math.sin(degToRad(deg));
}
export function cosDeg(deg: number): number {
  return Math.cos(degToRad(deg));
}
