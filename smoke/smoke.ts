// 纯逻辑冒烟测试：几何、遮挡、空间参数
import { samplePath, sampleHeading, occlusionTransparency, segmentsIntersect } from '../src/model/geometry';
import { computeSpatialParams } from '../src/audio/spatial';
import type { SourceDef } from '../src/model/types';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) { console.error('FAIL:', msg); fails++; } else console.log('ok:', msg);
};

// 路径采样
const path = [{ time: 0, x: 0, y: 0 }, { time: 10, x: 10, y: 0 }];
ok(Math.abs(samplePath(path, 5).x - 5) < 1e-9, '路径中点插值');
ok(samplePath(path, -1).x === 0 && samplePath(path, 99).x === 10, '路径两端钳制');

// 朝向采样（跨 ±π 最短弧）
const h = sampleHeading([{ time: 0, angle: Math.PI - 0.1 }, { time: 10, angle: -Math.PI + 0.1 }], 5);
ok(Math.abs(Math.abs(h) - Math.PI) < 0.01, '朝向跨 ±π 插值');

// 线段相交 & 遮挡
ok(segmentsIntersect(0, 0, 10, 0, 5, -5, 5, 5), '线段相交判定');
ok(!segmentsIntersect(0, 0, 1, 0, 5, -5, 5, 5), '线段不相交判定');
const walls = [
  { id: 'w1', ax: 5, ay: -5, bx: 5, by: 5, transmission: 0.2 },
  { id: 'w2', ax: 8, ay: -5, bx: 8, by: 5, transmission: 0.5 },
];
ok(Math.abs(occlusionTransparency({ x: 0, y: 0 }, { x: 10, y: 0 }, walls) - 0.1) < 1e-9, '穿两道墙透射系数相乘');
ok(occlusionTransparency({ x: 0, y: 0 }, { x: 2, y: 0 }, walls) === 1, '无遮挡透射为 1');

// 空间参数
const src: SourceDef = { id: 's', name: 's', kind: 'voice', color: '', path: [], facing: 0, elevation: 0, gain: 1, startTime: 0, loop: true, bufferId: null };
let sp = computeSpatialParams(src, { x: 0, y: -5 }, { x: 0, y: 0 }, 0, []);
ok(sp.pz > 4.9 && Math.abs(sp.px) < 1e-9, '正后方声源 pz 为正（Web Audio 后方=+z）');
sp = computeSpatialParams(src, { x: 0, y: 5 }, { x: 0, y: 0 }, 0, []);
ok(sp.pz < -4.9, '正前方声源 pz 为负（Web Audio 前方=-z）');
sp = computeSpatialParams(src, { x: 0, y: 5 }, { x: 0, y: 0 }, Math.PI / 2, []);
ok(sp.px < -4.9, '听者右转后正前声源移到左侧');
const near = computeSpatialParams(src, { x: 0, y: 2 }, { x: 0, y: 0 }, 0, []);
const far = computeSpatialParams(src, { x: 0, y: 40 }, { x: 0, y: 0 }, 0, []);
ok(far.airAbsorbHz < near.airAbsorbHz, '距离远空气吸收低通更低');
ok(far.reverbSend > near.reverbSend, '距离远混响发送更大');
const blocked = computeSpatialParams(src, { x: 0, y: 0 }, { x: 10, y: 0 }, 0, walls);
ok(blocked.occlusionHz < 5000 && blocked.occlusionGain < 1, '隔墙低通+衰减生效');
// 听者在声源的 +y 方向：facing=π 背对 → 衰减；facing=0 面向 → 不衰减
const behind = computeSpatialParams({ ...src, facing: Math.PI }, { x: 0, y: -3 }, { x: 0, y: 0 }, 0, []);
const facing = computeSpatialParams({ ...src, facing: 0 }, { x: 0, y: -3 }, { x: 0, y: 0 }, 0, []);
ok(behind.directivityDb < -10 && facing.directivityDb === 0, '背对听者高频搁架衰减');
const up = computeSpatialParams({ ...src, elevation: 2 }, { x: 0, y: 1 }, { x: 0, y: 0 }, 0, []);
ok(up.py === 2, '高度传入 Y 分量');

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails ? 1 : 0);
