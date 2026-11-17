import { performance } from 'node:perf_hooks';
import { BinauralRenderer } from '../dsp/renderer.js';
import { buildStressProject } from './demo.js';
import { WavFileSource } from '../io/wavReader.js';
import { join, resolve } from 'node:path';
import type { AudioSource } from '../io/audioSource.js';

/** 内存素材源（零 IO 开销对照组） */
class MemorySource implements AudioSource {
  readonly id: string;
  readonly sampleRate: number;
  readonly channels = 1;
  readonly frames: number;
  constructor(id: string, sampleRate: number, frames: number) {
    this.id = id;
    this.sampleRate = sampleRate;
    this.frames = frames;
  }
  readBlock(frame: number, n: number, out: Float32Array): number {
    for (let i = 0; i < n; i++) {
      const f = frame + i;
      out[i]! = f >= 0 && f < this.frames ? 0.2 * Math.sin(2 * Math.PI * 220 * (f / this.sampleRate)) : 0;
    }
    return n;
  }
}

function bench(label: string, run: () => number, programSeconds: number): void {
  // 预热
  run();
  const t0 = performance.now();
  const blocks = run();
  const elapsed = (performance.now() - t0) / 1000;
  console.log(
    `${label.padEnd(28)} ${elapsed.toFixed(2)}s  (${(programSeconds / elapsed).toFixed(1)}x 实时, ${blocks} 块)`,
  );
}

const outDir = resolve('workdir');
const base = buildStressProject(outDir);
const seconds = 30;
const project = { ...base, duration: seconds };
const sr = project.sampleRate;
const blockSize = 4096;
const subBlock = 256;
const totalBlocks = Math.ceil((seconds * sr) / blockSize);

function runWith(sources: AudioSource[]): () => number {
  return () => {
    const r = new BinauralRenderer(project, sources, blockSize, subBlock);
    for (let b = 0; b < totalBlocks; b++) r.renderBlock((b * blockSize) / sr);
    return totalBlocks;
  };
}

const memSources = project.clips.map((c) => new MemorySource(c.id, sr, seconds * sr));
bench('20 声部 全链(内存素材)', runWith(memSources), seconds);

const noSrcProject = { ...project, sources: [] };
const r0 = new BinauralRenderer(noSrcProject, memSources, blockSize, subBlock);
bench('0 声部(仅房间引擎)', () => {
  for (let b = 0; b < totalBlocks; b++) r0.renderBlock((b * blockSize) / sr);
  return totalBlocks;
}, seconds);

const diskSources = project.clips.map(
  (c) => new WavFileSource(c.id, join(outDir, c.url)),
);
bench('20 声部 全链(磁盘 WAV)', runWith(diskSources), seconds);
for (const s of diskSources) (s as WavFileSource).close();

// 单声部成本（线性度检查）
const oneProject = { ...project, sources: project.sources.slice(0, 1) };
const r1 = new BinauralRenderer(oneProject, memSources, blockSize, subBlock);
bench('1 声部 全链(内存素材)', () => {
  for (let b = 0; b < totalBlocks; b++) r1.renderBlock((b * blockSize) / sr);
  return totalBlocks;
}, seconds);
