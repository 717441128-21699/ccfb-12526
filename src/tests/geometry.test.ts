import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeSpatial } from '../core/geometry.js';
import { evaluateOcclusion } from '../core/occlusion.js';
import type { ListenerState, Occluder } from '../core/types.js';

const listener: ListenerState = { pos: { x: 0, y: 0 }, yaw: 0, pitch: 0 };

test('听者转头时声源方位角跟随旋转', () => {
  const src = { x: 1, y: 0 }; // 世界坐标正前方
  const front = relativeSpatial(src, listener);
  assert.equal(front.azimuth, 0);

  // 听者向右转头 90°（yaw=90），原正前方声源应落到左耳 -90°
  const turned: ListenerState = { pos: { x: 0, y: 0 }, yaw: 90, pitch: 0 };
  const side = relativeSpatial(src, turned);
  assert.ok(Math.abs(side.azimuth - -90) < 1e-9);
});

test('正后方方位角为 ±180', () => {
  const behind = relativeSpatial({ x: -1, y: 0 }, listener);
  assert.ok(Math.abs(Math.abs(behind.azimuth) - 180) < 1e-9);
});

test('距离计算', () => {
  const s = relativeSpatial({ x: 3, y: 4 }, listener);
  assert.ok(Math.abs(s.distance - 5) < 1e-9);
});

test('隔墙产生低通与电平损耗', () => {
  const wall: Occluder = {
    id: 'w',
    a: { x: 1, y: -5 },
    b: { x: 1, y: 5 },
    material: 'wall',
  };
  const blocked = evaluateOcclusion({ x: 5, y: 0 }, { x: -5, y: 0 }, [wall]);
  assert.ok(blocked.wallCount >= 1);
  assert.ok(blocked.cutoff < 21000);
  assert.ok(blocked.lossDb > 0);

  const clear = evaluateOcclusion({ x: -5, y: 0 }, { x: -6, y: 0 }, [wall]);
  assert.equal(clear.wallCount, 0);
  assert.equal(clear.lossDb, 0);
});

test('重墙比薄墙更闷、损耗更大', () => {
  const mk = (material: Occluder['material']): Occluder => ({
    id: material,
    a: { x: 1, y: -5 },
    b: { x: 1, y: 5 },
    material,
  });
  const thin = evaluateOcclusion({ x: 5, y: 0 }, { x: -5, y: 0 }, [mk('thin_wall')]);
  const heavy = evaluateOcclusion({ x: 5, y: 0 }, { x: -5, y: 0 }, [mk('heavy_wall')]);
  assert.ok(heavy.cutoff < thin.cutoff);
  assert.ok(heavy.lossDb > thin.lossDb);
});
