import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BinauralRenderer } from '../dsp/renderer.js';
import { OnePoleLowpass } from '../dsp/filters.js';
import type { Project } from '../core/types.js';
import type { AudioSource } from '../io/audioSource.js';

class NoiseSource implements AudioSource {
  readonly id = 'c';
  readonly sampleRate = 48000;
  readonly channels = 1;
  readonly frames = 48000 * 10;
  private a = 12345;
  readBlock(frame: number, n: number, out: Float32Array): number {
    let a = this.a;
    for (let i = 0; i < n; i++) {
      a = (a * 1103515245 + 12345) & 0x7fffffff;
      out[i] = 0.2 * ((a / 0x7fffffff) * 2 - 1);
    }
    this.a = a;
    return n;
  }
}

function projectAt(azDeg: number, d = 1.5, extra: Partial<Project> = {}): Project {
  const rad = (azDeg * Math.PI) / 180;
  return {
    version: 1,
    name: 't',
    sampleRate: 48000,
    duration: 2,
    listenerKeys: [{ t: 0, x: 0, y: 0, yaw: 0 }],
    sources: [
      {
        id: 's',
        name: 's',
        clipId: 'c',
        type: 'ambience',
        start: 0,
        inPoint: 0,
        duration: 2,
        gainDb: 0,
        minDistance: 0.4,
        maxDistance: 40,
        directivity: 0,
        keys: [{ t: 0, x: Math.cos(rad) * d, y: Math.sin(rad) * d }],
      },
    ],
    rooms: [],
    occluders: [],
    sceneAutomation: [],
    clips: [{ id: 'c', name: 'c', url: 'c.wav', sampleRate: 48000, frames: 480000, channels: 1 }],
    ...extra,
  };
}

function energy(buf: Float32Array, from = 200, to = 1000): number {
  let e = 0;
  for (let i = from; i < to; i++) e += buf[i]! * buf[i]!;
  return e;
}

test('ILD：右侧声源右耳更响，左侧对称，正前方等响', () => {
  const right = new BinauralRenderer(projectAt(90), [new NoiseSource()], 4096, 256).renderBlock(0.5);
  const left = new BinauralRenderer(projectAt(-90), [new NoiseSource()], 4096, 256).renderBlock(0.5);
  const front = new BinauralRenderer(projectAt(0), [new NoiseSource()], 4096, 256).renderBlock(0.5);

  assert.ok(energy(right.right) > energy(right.left) * 1.5, '90° 右耳应明显更响');
  assert.ok(energy(left.left) > energy(left.right) * 1.5, '-90° 左耳应明显更响');
  assert.ok(Math.abs(energy(front.left) - energy(front.right)) / energy(front.left) < 0.05, '正前方应等响');
});

test('ITD：右侧声源右耳信号提前（互相关 lag 符号）', () => {
  const r = new BinauralRenderer(projectAt(90), [new NoiseSource()], 4096, 256).renderBlock(0.5);
  let bestLag = 0;
  let bestVal = -Infinity;
  for (let lag = -40; lag <= 40; lag++) {
    let v = 0;
    for (let i = 200; i < 900; i++) {
      const j = i + lag;
      if (j >= 0 && j < 1024) v += r.left[i]! * r.right[j]!;
    }
    if (v > bestVal) {
      bestVal = v;
      bestLag = lag;
    }
  }
  // right 提前于 left：left[i] 与 right[i+lag] 对齐时 lag 为负（|lag| 即 ITD 样本数）
  assert.ok(bestLag < 0, `期望负 lag（右耳提前），实得 ${bestLag}`);
  assert.ok(Math.abs(bestLag) >= 1, 'ITD 应至少 1 个样本量级');
});

test('距离：远场 RMS 小于近场', () => {
  const near = new BinauralRenderer(projectAt(45, 1), [new NoiseSource()], 4096, 256).renderBlock(0.5);
  const far = new BinauralRenderer(projectAt(45, 8), [new NoiseSource()], 4096, 256).renderBlock(0.5);
  assert.ok(energy(near.left) > energy(far.left) * 4, '1m 能量应远大于 8m');
});

test('输出有界不削波，且非静音', () => {
  const { left, right } = new BinauralRenderer(projectAt(45), [new NoiseSource()], 4096, 256).renderBlock(0.5);
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < 1024; i++) {
    peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
    sumSq += left[i]! * left[i]! + right[i]! * right[i]!;
  }
  assert.ok(peak < 1, `峰值应小于 1，实得 ${peak}`);
  assert.ok(sumSq > 1e-4, '输出不应为静音');
});

test('一阶低通：截止越低高频衰减越多', () => {
  const sr = 48000;
  const measure = (fc: number): number => {
    const lp = new OnePoleLowpass();
    lp.setCutoff(fc, sr);
    const inp = new Float32Array(2048);
    const out = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) inp[i] = Math.sin(2 * Math.PI * 4000 * (i / sr));
    lp.processBlock(inp, out, 2048);
    return energy(out, 1024, 2048);
  };
  assert.ok(measure(20000) > measure(1000) * 2, '20kHz 截止应保留更多 4kHz 能量');
});

test('室内外房间引擎湿声可区分', () => {
  const indoor = projectAt(45, 2, {
    rooms: [
      {
        id: 'in',
        name: '室内',
        kind: 'indoor',
        polygon: [
          { x: -10, y: -10 },
          { x: 10, y: -10 },
          { x: 10, y: 10 },
          { x: -10, y: 10 },
        ],
        rt60: 0.9,
        roomSize: 10,
        levelDb: -10,
        hfDamping: 0.5,
        fadeSeconds: 1,
      },
    ],
  });
  const outdoor = projectAt(45, 2, {
    rooms: [
      {
        id: 'out',
        name: '室外',
        kind: 'outdoor',
        polygon: [
          { x: -10, y: -10 },
          { x: 10, y: -10 },
          { x: 10, y: 10 },
          { x: -10, y: 10 },
        ],
        rt60: 0.15,
        roomSize: 30,
        levelDb: -30,
        hfDamping: 0.1,
        fadeSeconds: 1,
      },
    ],
  });
  const ri = new BinauralRenderer(indoor, [new NoiseSource()], 4096, 256).renderBlock(0.5);
  const ro = new BinauralRenderer(outdoor, [new NoiseSource()], 4096, 256).renderBlock(0.5);
  // 室内湿声电平高，整体能量应大于室外（干声相同）
  assert.ok(energy(ri.left) + energy(ri.right) > energy(ro.left) + energy(ro.right));
});
