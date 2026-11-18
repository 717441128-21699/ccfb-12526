import type { Project } from '../model/types';
import { samplePath, sampleHeading } from '../model/geometry';
import { computeSpatialParams } from './spatial';
import { buildSourceChain, ReverbBus } from './chain';
import { makeImpulseResponse } from './ir';
import type { AudioStore } from './store';

/**
 * 离线渲染整集：OfflineAudioContext 跑多快算多快，不受实时约束。
 * 空间参数按自适应采样写成自动化包络——直线段、静止段几乎不产生事件，
 * 40 分钟 × 20 声部也能压在远小于实时的时间内渲完。
 */
export async function renderProject(
  project: Project,
  store: AudioStore,
  onProgress?: (frac: number) => void,
  sampleRate = 48000,
): Promise<AudioBuffer> {
  const dur = project.duration;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  // 混响总线 + 场景切换的乒乓交叉淡化
  const reverb = new ReverbBus(ctx, master);
  const first = project.scenes[0];
  reverb.init(makeImpulseResponse(ctx, first.preset), first.preset.wet);
  const FADE = 3;
  for (let i = 1; i < project.scenes.length; i++) {
    const span = project.scenes[i];
    reverb.scheduleTransition(
      makeImpulseResponse(ctx, span.preset, i + 1), span.preset.wet,
      Math.max(0, span.start - FADE / 2), FADE,
    );
  }

  // 听者位置与朝向：关键帧间线性斜坡（轨道本来就是分段线性的）
  const lis = ctx.listener;
  automateVec2(lis.positionX, lis.positionZ, project.listener.path);
  automateScalar(lis.forwardX, project.listener.heading.map(k => ({ time: k.time, value: Math.sin(k.angle) })));
  automateScalar(lis.forwardZ, project.listener.heading.map(k => ({ time: k.time, value: -Math.cos(k.angle) })));
  lis.upX.value = 0; lis.upY.value = 1; lis.upZ.value = 0;

  // 每个声部一条处理链
  const chains = project.sources.map(src => {
    const chain = buildSourceChain(ctx, master, reverb.input);
    chain.input.gain.value = src.gain;
    const buf = store.get(src.bufferId);
    if (buf) {
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.loop = src.loop;
      node.connect(chain.input);
      node.start(Math.min(src.startTime, dur));
    }
    return { src, chain };
  });

  // 自适应采样：10Hz 扫一遍，变化超阈值才写自动化点
  const STEP = 0.1;
  const EPS = { pos: 0.005, freq: 1.015, gain: 0.003, db: 0.2 };
  const last = chains.map(() => ({ px: 1e9, py: 1e9, pz: 1e9, air: 0, occF: 0, occG: 0, dir: 0, send: 0 }));

  for (let t = 0; t <= dur; t += STEP) {
    const tt = Math.min(t, dur);
    const lisPos = samplePath(project.listener.path, tt);
    const lisHead = sampleHeading(project.listener.heading, tt);
    chains.forEach(({ src, chain }, i) => {
      const pos = samplePath(src.path, tt);
      const p = computeSpatialParams(src, pos, lisPos, lisHead, project.walls);
      const L = last[i];
      if (Math.abs(p.px - L.px) > EPS.pos || Math.abs(p.pz - L.pz) > EPS.pos || Math.abs(p.py - L.py) > EPS.pos) {
        chain.panner.positionX.linearRampToValueAtTime(p.px, tt);
        chain.panner.positionY.linearRampToValueAtTime(p.py, tt);
        chain.panner.positionZ.linearRampToValueAtTime(p.pz, tt);
        L.px = p.px; L.py = p.py; L.pz = p.pz;
      }
      if (Math.abs(p.airAbsorbHz - L.air) > L.air * (EPS.freq - 1)) {
        chain.airAbsorb.frequency.linearRampToValueAtTime(p.airAbsorbHz, tt); L.air = p.airAbsorbHz;
      }
      if (Math.abs(p.occlusionHz - L.occF) > L.occF * (EPS.freq - 1)) {
        chain.occlusionLp.frequency.linearRampToValueAtTime(p.occlusionHz, tt); L.occF = p.occlusionHz;
      }
      if (Math.abs(p.occlusionGain - L.occG) > EPS.gain) {
        chain.occlusionGain.gain.linearRampToValueAtTime(p.occlusionGain, tt); L.occG = p.occlusionGain;
      }
      if (Math.abs(p.directivityDb - L.dir) > EPS.db) {
        chain.directivity.gain.linearRampToValueAtTime(p.directivityDb, tt); L.dir = p.directivityDb;
      }
      if (Math.abs(p.reverbSend - L.send) > EPS.gain) {
        chain.reverbSend.gain.linearRampToValueAtTime(p.reverbSend, tt); L.send = p.reverbSend;
      }
    });
  }

  // 每渲 5 秒挂起一次回报进度
  if (onProgress) {
    for (let t = 5; t < dur; t += 5) {
      ctx.suspend(t).then(() => { onProgress(t / dur); void ctx.resume(); });
    }
  }

  const rendered = await ctx.startRendering();
  onProgress?.(1);
  return rendered;
}

function automateVec2(px: AudioParam, pz: AudioParam, path: { time: number; x: number; y: number }[]): void {
  if (path.length === 0) return;
  px.setValueAtTime(path[0].x, 0); pz.setValueAtTime(path[0].y, 0);
  for (const k of path) {
    px.linearRampToValueAtTime(k.x, k.time);
    pz.linearRampToValueAtTime(k.y, k.time);
  }
}

function automateScalar(param: AudioParam, keys: { time: number; value: number }[]): void {
  if (keys.length === 0) return;
  param.setValueAtTime(keys[0].value, 0);
  for (const k of keys) param.linearRampToValueAtTime(k.value, k.time);
}

/** AudioBuffer → 16bit 立体声 WAV */
export function encodeWav(buf: AudioBuffer): Blob {
  const ch = Math.min(2, buf.numberOfChannels);
  const len = buf.length * ch * 2;
  const out = new DataView(new ArrayBuffer(44 + len));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + len, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, len, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}
