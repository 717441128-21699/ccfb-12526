import type { SourceDef, Wall, Vec2 } from '../model/types';
import { occlusionTransparency, angleDiff, clamp } from '../model/geometry';

/**
 * 空间声学参数计算：纯函数，实时预览和离线渲染共用同一套，
 * 保证"拖的时候听到的"和"渲染出来的"一致。
 */
export interface SpatialParams {
  /** 听者坐标系下的位置（米），y 向上 */
  px: number; py: number; pz: number;
  distance: number;
  /** 空气吸收低通截止频率（Hz）：越远越闷 */
  airAbsorbHz: number;
  /** 遮挡低通截止频率（Hz）：隔墙的闷声 */
  occlusionHz: number;
  occlusionGain: number;
  /** 声源指向性高频搁架增益（dB）：背对听者时掉高频 */
  directivityDb: number;
  /** 距离决定的混响发送量：越远湿声占比越大 */
  reverbSend: number;
}

export function computeSpatialParams(
  src: SourceDef,
  srcPos: Vec2,
  lisPos: Vec2,
  lisHeading: number,
  walls: Wall[],
): SpatialParams {
  const dx = srcPos.x - lisPos.x;
  const dz = srcPos.y - lisPos.y; // 俯视图 y = 世界 z（向后为正）
  const distance = Math.max(0.1, Math.hypot(dx, dz, src.elevation));

  // 把声源位置旋进听者朝向坐标系：头一转，所有方位跟着转。
  // Web Audio 约定：+x = 右，-z = 前。地图约定：+y = 图上 = 朝向 0 的前方。
  const cos = Math.cos(lisHeading), sin = Math.sin(lisHeading);
  const px = dx * cos - dz * sin;        // 右分量
  const pz = -(dx * sin + dz * cos);     // 前分量取负 → Web Audio z

  // 空气吸收：距离每增加，高频按指数滚降
  const airAbsorbHz = clamp(20000 * Math.exp(-distance / 25), 800, 20000);

  // 墙体遮挡：透射系数映射到低通截止频率 + 额外衰减
  const trans = occlusionTransparency(srcPos, lisPos, walls);
  const occlusionHz = trans >= 0.999 ? 20000 : clamp(20000 * Math.pow(trans, 1.5), 300, 20000);
  const occlusionGain = trans >= 0.999 ? 1 : clamp(0.35 + 0.65 * trans, 0.1, 1);

  // 声源指向性：角色面朝方向 vs 指向听者的方向；背对时高频搁架最多 -14dB
  // 角度约定与地图一致：0 = 图上（+y），顺时针为正；声源→听者向量 = (-dx, -dz)
  const toListener = Math.atan2(-dx, -dz);
  const offAxis = Math.abs(angleDiff(toListener, src.facing));
  const behind = clamp((offAxis - Math.PI / 4) / (Math.PI * 0.75), 0, 1); // 45° 后开始衰减
  const directivityDb = -14 * behind;

  // 距离越远，直达声越弱（PannerNode 负责），混响占比相对上升
  const reverbSend = clamp(0.25 + distance / 20, 0.25, 1);

  return {
    px, py: src.elevation, pz,
    distance, airAbsorbHz,
    occlusionHz, occlusionGain,
    directivityDb, reverbSend,
  };
}
