import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderProject } from '../io/renderProject.js';
import type { AudioClip, Keyframe, Project, SourceTrack, Vec2 } from '../core/types.js';

/**
 * 生成一个可直接渲染的演示工程（无需真实录音素材）：
 *  - 合成 5 类测试信号 WAV（人声样带、脚步、雨声、风声、门铃）
 *  - 听者转头、角色从左走到右、绕到身后耳语、隔墙对话、室内外场景切换
 *  - 另生成 20 声部压力测试工程，用于验证 40 分钟/20 轨的 3 分钟渲染预算
 */

const SR = 48000;

function pcm16(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-1, Math.min(1, samples[i]!)) * 32767, i * 2);
  }
  return buf;
}

function writeWavMono(path: string, samples: Float32Array): void {
  const data = pcm16(samples);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

/** 类语音信号：基频颤动 + 共振峰 + 音节包络，听起来像连续说话 */
function synthVoice(seconds: number, seed: number): Float32Array {
  const n = seconds * SR;
  const out = new Float32Array(n);
  let rng = mulberry(seed);
  const f0 = 110 + rng() * 60;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const syllable = 0.45 + 0.55 * Math.abs(Math.sin(2 * Math.PI * (2.8 + rng() * 0.0) * t + seed));
    const vibrato = 1 + 0.02 * Math.sin(2 * Math.PI * 5 * t);
    const ph = 2 * Math.PI * f0 * vibrato * t;
    // 三个共振峰
    let v = Math.sin(ph) * 0.5 + Math.sin(ph * 2) * 0.25 + Math.sin(ph * 3) * 0.12;
    v *= syllable * 0.55;
    out[i] = v;
  }
  return fadeEdges(out);
}

/** 脚步：周期性低频脉冲 */
function synthSteps(seconds: number, seed: number): Float32Array {
  const n = seconds * SR;
  const out = new Float32Array(n);
  const rng = mulberry(seed);
  const period = 0.52;
  for (let k = 0; k * period < seconds; k++) {
    const start = Math.floor((k * period + rng() * 0.04) * SR);
    const len = Math.floor(0.09 * SR);
    for (let j = 0; j < len && start + j < n; j++) {
      const env = Math.exp(-j / (0.02 * SR));
      out[start + j]! += env * (Math.sin(2 * Math.PI * 90 * (j / SR)) * 0.5 + (rng() - 0.5) * 0.3);
    }
  }
  return fadeEdges(out);
}

/** 滤波白噪声（雨声/风声共用，截止不同） */
function synthNoise(seconds: number, seed: number, cutoff: number): Float32Array {
  const n = seconds * SR;
  const out = new Float32Array(n);
  const rng = mulberry(seed);
  const x = Math.exp((-2 * Math.PI * cutoff) / SR);
  let z = 0;
  for (let i = 0; i < n; i++) {
    z = (1 - x) * (rng() * 2 - 1) + x * z;
    out[i] = z * 2.2;
  }
  return fadeEdges(out);
}

/** 门铃：两个谐波音，衰减 */
function synthBell(seconds: number): Float32Array {
  const n = seconds * SR;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-2.2 * t);
    out[i] = env * (Math.sin(2 * Math.PI * 660 * t) * 0.4 + Math.sin(2 * Math.PI * 990 * t) * 0.25);
  }
  return fadeEdges(out);
}

function fadeEdges(buf: Float32Array): Float32Array {
  const f = Math.min(512, buf.length >> 2);
  for (let i = 0; i < f; i++) {
    const g = i / f;
    buf[i]! *= g;
    buf[buf.length - 1 - i]! *= g;
  }
  return buf;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kf(t: number, x: number, y: number, yaw?: number): Keyframe {
  return yaw === undefined ? { t, x, y } : { t, x, y, yaw };
}

export function buildDemoProject(outDir: string): { project: Project; dir: string } {
  const audioDir = join(outDir, 'audio');
  mkdirSync(audioDir, { recursive: true });

  const clips: AudioClip[] = [
    makeClip(audioDir, 'voice_a', '角色A 台词.wav', synthVoice(30, 11)),
    makeClip(audioDir, 'voice_b', '角色B 台词.wav', synthVoice(30, 27)),
    makeClip(audioDir, 'steps', '脚步声.wav', synthSteps(30, 7)),
    makeClip(audioDir, 'rain', '雨声.wav', synthNoise(30, 3, 3500)),
    makeClip(audioDir, 'wind', '风声.wav', synthNoise(30, 5, 500)),
    makeClip(audioDir, 'bell', '门铃.wav', synthBell(6)),
  ];

  const roomIndoor = {
    id: 'room_living',
    name: '客厅',
    kind: 'indoor' as const,
    polygon: [
      { x: -6, y: -4 },
      { x: 6, y: -4 },
      { x: 6, y: 4 },
      { x: -6, y: 4 },
    ],
    rt60: 0.62,
    roomSize: 8,
    levelDb: -16,
    hfDamping: 0.55,
    fadeSeconds: 1.5,
  };
  const roomOutdoor = {
    id: 'room_garden',
    name: '花园',
    kind: 'outdoor' as const,
    polygon: [
      { x: 6, y: -8 },
      { x: 16, y: -8 },
      { x: 16, y: 8 },
      { x: 6, y: 8 },
    ],
    rt60: 0.16,
    roomSize: 24,
    levelDb: -28,
    hfDamping: 0.12,
    fadeSeconds: 1.5,
  };

  const wall = {
    id: 'wall_1',
    a: { x: 2, y: -4 } as Vec2,
    b: { x: 2, y: 4 } as Vec2,
    material: 'wall' as const,
  };

  // 听者：站在客厅中央，期间转头两次，最后走向花园
  const listenerKeys = [
    kf(0, 0, 0, 90),
    kf(6, 0, 0, 90),
    kf(9, 0, 0, -90), // 转头 180°
    kf(14, 0, 0, -90),
    kf(17, 0, 0, 0), // 再转向花园方向
    kf(20, 4, 0, 0),
    kf(24, 11, 0, 0), // 穿过门进入室外
    kf(30, 11, 0, 0),
  ];

  const sources: SourceTrack[] = [
    {
      id: 'src_a',
      name: '角色A（左→右走过）',
      clipId: 'voice_a',
      type: 'voice',
      start: 0,
      inPoint: 0,
      duration: 14,
      gainDb: 0,
      minDistance: 0.4,
      maxDistance: 22,
      directivity: 0.8,
      keys: [kf(0, -5, 1.5), kf(5, 0, 1.5), kf(10, 5, 1.5), kf(14, 8, 1.5)],
    },
    {
      id: 'src_b',
      name: '角色B（身后靠近耳语→走开）',
      clipId: 'voice_b',
      type: 'voice',
      start: 2,
      inPoint: 0,
      duration: 12,
      gainDb: -2,
      minDistance: 0.25,
      maxDistance: 20,
      directivity: 0.9,
      keys: [kf(2, 0, -6), kf(7, 0, -1.2), kf(9, 0, -0.4), kf(14, 0, -7)],
    },
    {
      id: 'src_steps',
      name: '脚步（跟随角色A）',
      clipId: 'steps',
      type: 'ambience',
      start: 0,
      inPoint: 0,
      duration: 14,
      gainDb: -4,
      minDistance: 0.4,
      maxDistance: 18,
      directivity: 0,
      keys: [kf(0, -5, 1.1), kf(5, 0, 1.1), kf(10, 5, 1.1), kf(14, 8, 1.1)],
    },
    {
      id: 'src_rain',
      name: '雨声（花园环境声，隔墙）',
      clipId: 'rain',
      type: 'ambience',
      start: 0,
      inPoint: 0,
      duration: 30,
      gainDb: -8,
      minDistance: 1,
      maxDistance: 30,
      directivity: 0,
      keys: [kf(0, 12, 3), kf(30, 12, 3)],
    },
    {
      id: 'src_wind',
      name: '风声（室外远景）',
      clipId: 'wind',
      type: 'ambience',
      start: 18,
      inPoint: 0,
      duration: 12,
      gainDb: -10,
      minDistance: 2,
      maxDistance: 40,
      directivity: 0,
      keys: [kf(18, 14, -5), kf(30, 14, -5)],
    },
    {
      id: 'src_bell',
      name: '门铃（门外，穿墙）',
      clipId: 'bell',
      type: 'ambience',
      start: 10.5,
      inPoint: 0,
      duration: 4,
      gainDb: -3,
      minDistance: 0.4,
      maxDistance: 20,
      directivity: 0,
      keys: [kf(10.5, 3.2, 2.5), kf(14.5, 3.2, 2.5)],
    },
  ];

  const project: Project = {
    version: 1,
    name: '演示工程：耳语与穿墙',
    sampleRate: SR,
    duration: 30,
    listenerKeys,
    sources,
    rooms: [roomIndoor, roomOutdoor],
    occluders: [wall],
    clips,
    sceneAutomation: [],
  };

  writeFileSync(join(outDir, 'demo-project.json'), JSON.stringify(project, null, 2), 'utf8');
  return { project, dir: outDir };
}

function makeClip(
  audioDir: string,
  id: string,
  fileName: string,
  samples: Float32Array,
): AudioClip {
  const path = join(audioDir, fileName);
  writeWavMono(path, samples);
  return { id, name: fileName, url: `audio/${fileName}`, sampleRate: SR, frames: samples.length, channels: 1 };
}

/** 20 声部 / 40 分钟压力工程：验证渲染预算 */
export function buildStressProject(outDir: string): Project {
  const { project } = buildDemoProject(outDir);
  const rng = mulberry(99);
  project.name = '压力测试：20 声部 40 分钟';
  project.duration = 2400;
  project.sources = [];
  for (let i = 0; i < 20; i++) {
    const clip = project.clips[i % project.clips.length]!;
    const x0 = -8 + rng() * 16;
    const y0 = -6 + rng() * 12;
    const keys: Keyframe[] = [];
    const segments = 8;
    for (let s = 0; s <= segments; s++) {
      keys.push(
        kf(
          (s / segments) * project.duration,
          -8 + rng() * 24,
          -7 + rng() * 14,
        ),
      );
    }
    void x0;
    void y0;
    const track: SourceTrack = {
      id: `stress_${i}`,
      name: `压力声部 ${i + 1}`,
      clipId: clip.id,
      type: i % 3 === 0 ? 'voice' : 'ambience',
      start: rng() * 60,
      inPoint: 0,
      duration: project.duration - 60,
      gainDb: -10 - rng() * 8,
      minDistance: 0.4,
      maxDistance: 25,
      directivity: 0.7,
      keys,
    };
    project.sources.push(track);
  }
  writeFileSync(join(outDir, 'stress-project.json'), JSON.stringify(project, null, 2), 'utf8');
  return project;
}

// 直接运行：生成工程 + 渲染 demo + 渲染 60s 压力样本并报告速度
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const outDir = resolve('workdir');
  const { project, dir } = buildDemoProject(outDir);
  console.log('演示工程已生成:', join(dir, 'demo-project.json'));
  const r1 = renderProject(project, dir, join(dir, 'demo-binaural.wav'), {
    onProgress: (f, e) => process.stdout.write(`\rdemo 渲染 ${(f * 100).toFixed(0)}% ${e.toFixed(1)}s`),
  });
  console.log(`\nDemo: ${r1.durationSeconds.toFixed(0)}s 节目 → ${r1.renderSeconds.toFixed(2)}s 渲染（${r1.speedFactor.toFixed(1)}x）`);

  const stress = buildStressProject(outDir);
  const short = { ...stress, duration: 60 };
  const r2 = renderProject(short, dir, join(dir, 'stress-60s.wav'), {});
  const projected40Min = (r2.renderSeconds / 60) * 2400;
  console.log(
    `压力: 20 声部 60s → ${r2.renderSeconds.toFixed(2)}s；` +
      `推算 40 分钟全片约 ${projected40Min.toFixed(0)}s（预算 180s）`,
  );
}
