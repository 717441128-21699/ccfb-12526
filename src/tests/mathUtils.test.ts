import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  lerp,
  equalPower,
  dbToGain,
  wrapDeg,
  sampleKeys,
  segmentsIntersect,
  pointInPolygon,
  KeyframeSampler,
} from '../core/mathUtils.js';
import type { Keyframe } from '../core/types.js';

test('clamp / lerp 基础', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
});

test('等功率淡化平方和为 1', () => {
  for (let u = 0; u <= 1.0001; u += 0.1) {
    const [a, b] = equalPower(Math.min(1, u));
    assert.ok(Math.abs(a * a + b * b - 1) < 1e-9);
  }
});

test('dbToGain', () => {
  assert.ok(Math.abs(dbToGain(0) - 1) < 1e-12);
  assert.ok(Math.abs(dbToGain(-6) - 0.5012) < 1e-3);
});

test('wrapDeg 角度包装到 (-180,180]', () => {
  assert.equal(wrapDeg(0), 0);
  assert.equal(wrapDeg(180), 180);
  assert.ok(Math.abs(wrapDeg(270) - -90) < 1e-9);
  assert.ok(Math.abs(wrapDeg(-190) - 170) < 1e-9);
});

test('sampleKeys 分段线性与钳位', () => {
  const keys: Keyframe[] = [
    { t: 0, x: 0, y: 0 },
    { t: 10, x: 10, y: 20 },
  ];
  assert.deepEqual(sampleKeys(keys, 5), { x: 5, y: 10, yaw: 0 });
  assert.equal(sampleKeys(keys, -5).x, 0); // 首部钳位
  assert.equal(sampleKeys(keys, 15).x, 10); // 尾部钳位
});

test('KeyframeSampler 顺序 O(1) 与 sampleKeys 结果一致', () => {
  const keys: Keyframe[] = [
    { t: 0, x: 0, y: 0 },
    { t: 2, x: 4, y: 0 },
    { t: 5, x: 10, y: 0 },
    { t: 9, x: 1, y: 0 },
  ];
  const s = new KeyframeSampler(keys);
  s.reset(0);
  for (let t = 0; t <= 9; t += 0.5) {
    const a = s.sample(t);
    const b = sampleKeys(keys, t);
    assert.ok(Math.abs(a.x - b.x) < 1e-9);
  }
  s.reset(6);
  assert.ok(Math.abs(s.sample(6).x - sampleKeys(keys, 6).x) < 1e-9);
});

test('segmentsIntersect 相交与平行', () => {
  assert.equal(
    segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 }),
    true,
  );
  assert.equal(
    segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }),
    false,
  );
});

test('pointInPolygon 内外判定', () => {
  const poly = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(pointInPolygon({ x: 5, y: 5 }, poly), true);
  assert.equal(pointInPolygon({ x: 15, y: 5 }, poly), false);
});
