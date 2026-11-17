import { resolve, dirname, isAbsolute } from 'node:path';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { BinauralRenderer } from '../dsp/renderer.js';
import { dbToGain } from '../core/mathUtils.js';
import { WavFileSource } from './wavReader.js';
import { WavWriter } from './wavWriter.js';
import type { AudioSource } from './audioSource.js';
import type { Project } from '../core/types.js';

export interface RenderOptions {
  /** 输出位深 */
  bits?: 16 | 24 | 32;
  /** 总线增益 dB */
  masterDb?: number;
  /** 块大小（样本） */
  blockSize?: number;
  onProgress?: (fraction: number, elapsedSec: number) => void;
}

export interface RenderResult {
  outputFrames: number;
  renderSeconds: number;
  durationSeconds: number;
  speedFactor: number;
}

/**
 * 离线渲染整集工程为双耳立体声 WAV。
 * 素材以流式读取，输出分块写盘，内存占用与工程时长无关。
 */
export function renderProject(
  project: Project,
  projectDir: string,
  outputPath: string,
  opts: RenderOptions = {},
): RenderResult {
  const blockSize = opts.blockSize ?? 4096;
  const sr = project.sampleRate;
  const sources: AudioSource[] = [];
  const opened: WavFileSource[] = [];

  try {
    for (const clip of project.clips) {
      const path = isAbsolute(clip.url) ? clip.url : resolve(projectDir, clip.url);
      const src = new WavFileSource(clip.id, path);
      if (src.sampleRate !== sr) {
        throw new Error(
          `素材 ${clip.name} 采样率 ${src.sampleRate} 与工程 ${sr} 不一致，请先统一采样率`,
        );
      }
      sources.push(src);
      opened.push(src);
    }

    const renderer = new BinauralRenderer(project, sources, blockSize);
    const writer = new WavWriter(outputPath, sr, opts.bits ?? 24);
    const totalFrames = Math.ceil(project.duration * sr);
    // 默认 -6dB 母带电平，叠加 softClip（上限 0.9）双重保护防止满幅削波
    const masterDb = opts.masterDb ?? -6;

    const t0 = performance.now();
    let frames = 0;
    let lastReport = 0;
    while (frames < totalFrames) {
      const t = frames / sr;
      const { left, right } = renderer.renderBlock(t);
      const take = Math.min(blockSize, totalFrames - frames);
      const trimmedL = take === blockSize ? left : left.subarray(0, take);
      const trimmedR = take === blockSize ? right : right.subarray(0, take);
      if (masterDb !== 0) {
        const g = dbToGain(masterDb);
        for (let i = 0; i < take; i++) {
          trimmedL[i]! *= g;
          trimmedR[i]! *= g;
        }
      }
      writer.writeStereo(trimmedL, trimmedR);
      frames += take;

      const now = performance.now();
      if (opts.onProgress && now - lastReport > 1000) {
        lastReport = now;
        opts.onProgress(frames / totalFrames, (now - t0) / 1000);
      }
    }
    writer.close();
    const renderSeconds = (performance.now() - t0) / 1000;
    const durationSeconds = totalFrames / sr;
    return {
      outputFrames: frames,
      renderSeconds,
      durationSeconds,
      speedFactor: durationSeconds / renderSeconds,
    };
  } finally {
    for (const s of opened) s.close();
  }
}

/** 加载并做基础校验 */
export function loadProject(jsonPath: string): { project: Project; projectDir: string } {
  const projectDir = dirname(resolve(jsonPath));
  const project = JSON.parse(readText(jsonPath)) as Project;
  validateProject(project);
  return { project, projectDir };
}

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

export function validateProject(p: Project): void {
  if (p.version !== 1) throw new Error('不支持的工程版本');
  if (!p.sampleRate || p.sampleRate < 8000) throw new Error('工程采样率非法');
  if (p.listenerKeys.length === 0) throw new Error('工程缺少听者关键帧');
  const clipIds = new Set(p.clips.map((c) => c.id));
  for (const s of p.sources) {
    if (!clipIds.has(s.clipId)) throw new Error(`声部 ${s.name} 引用了不存在的素材 ${s.clipId}`);
    if (s.keys.length === 0) throw new Error(`声部 ${s.name} 缺少路径关键帧`);
  }
}
