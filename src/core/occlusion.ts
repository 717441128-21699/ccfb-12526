import { pointSegmentDistance, segmentsIntersect, smoothstep } from './mathUtils.js';
import type { Occluder, OccluderMaterial, Vec2 } from './types.js';

export interface OcclusionResult {
  /** 0-1，1 = 完全遮挡 */
  amount: number;
  /** 等效低通截止频率 Hz */
  cutoff: number;
  /** 额外增益衰减 dB */
  lossDb: number;
  /** 穿过的墙数（用于日志/UI 提示） */
  wallCount: number;
}

const MATERIAL_TABLE: Record<
  OccluderMaterial,
  { cutoff: number; lossDb: number; weight: number }
> = {
  // 薄墙/木门：明显变闷但仍可懂
  thin_wall: { cutoff: 1800, lossDb: 8, weight: 0.7 },
  // 标准隔墙
  wall: { cutoff: 900, lossDb: 14, weight: 1 },
  // 承重墙/混凝土：高度闷塞
  heavy_wall: { cutoff: 420, lossDb: 22, weight: 1.4 },
};

const NO_OCCLUSION: OcclusionResult = { amount: 0, cutoff: 21000, lossDb: 0, wallCount: 0 };

/**
 * 检测源到听者连线上穿过的所有遮挡墙并合成等效滤波。
 * 连线与墙段相交即视为穿墙；同时考虑擦边（距离 < 0.15m）的半遮挡平滑。
 */
export function evaluateOcclusion(
  source: Vec2,
  listener: Vec2,
  occluders: Occluder[],
): OcclusionResult {
  let weightSum = 0;
  let lossDb = 0;
  let wallCount = 0;
  let cutoffLog = Math.log(21000);

  for (const oc of occluders) {
    const hit = segmentsIntersect(source, listener, oc.a, oc.b);
    const edge = pointSegmentDistance(listener, oc.a, oc.b);
    // 听者贴墙（0.3m 内）给一点平滑过渡，避免跨过墙线时音色突变
    const edgeFactor = hit ? 1 : 1 - smoothstep(0.05, 0.3, edge);
    if (!hit && edgeFactor <= 0) continue;

    const mat = MATERIAL_TABLE[oc.material];
    const w = mat.weight * edgeFactor;
    weightSum += w;
    lossDb += mat.lossDb * edgeFactor;
    cutoffLog += (Math.log(mat.cutoff) - Math.log(21000)) * edgeFactor;
    if (hit) wallCount++;
  }

  if (weightSum === 0) return NO_OCCLUSION;
  const amount = Math.min(1, weightSum / 1.4);
  return {
    amount,
    cutoff: Math.exp(cutoffLog),
    lossDb,
    wallCount,
  };
}
