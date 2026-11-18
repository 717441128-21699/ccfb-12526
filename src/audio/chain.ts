import type { SpatialParams } from './spatial';

/**
 * 单个声部的处理链（实时与离线共用同一结构）：
 *
 *  input → 指向性高频搁架 → 遮挡低通 → 遮挡增益 → 空气吸收低通
 *        → HRTF Panner → 干声增益 → 输出
 *                   └────→ 混响发送 → 混响总线
 *
 * HRTF Panner 是三维的：前后、上下、左右都靠它，不只是声像左右摆。
 */
export interface SourceChain {
  input: GainNode;
  directivity: BiquadFilterNode;
  occlusionLp: BiquadFilterNode;
  occlusionGain: GainNode;
  airAbsorb: BiquadFilterNode;
  panner: PannerNode;
  dry: GainNode;
  reverbSend: GainNode;
}

export function buildSourceChain(
  ctx: BaseAudioContext,
  out: AudioNode,
  reverbBus: AudioNode,
): SourceChain {
  const input = ctx.createGain();

  const directivity = ctx.createBiquadFilter();
  directivity.type = 'highshelf';
  directivity.frequency.value = 4000;
  directivity.gain.value = 0;

  const occlusionLp = ctx.createBiquadFilter();
  occlusionLp.type = 'lowpass';
  occlusionLp.frequency.value = 20000;
  occlusionLp.Q.value = 0.5;

  const occlusionGain = ctx.createGain();

  const airAbsorb = ctx.createBiquadFilter();
  airAbsorb.type = 'lowpass';
  airAbsorb.frequency.value = 20000;
  airAbsorb.Q.value = 0.5;

  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';        // 头相关传输函数：双耳渲染核心
  panner.distanceModel = 'inverse';    // 距离衰减
  panner.refDistance = 1;
  panner.rolloffFactor = 1;
  panner.maxDistance = 500;

  const dry = ctx.createGain();
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0.3;

  input.connect(directivity);
  directivity.connect(occlusionLp);
  occlusionLp.connect(occlusionGain);
  occlusionGain.connect(airAbsorb);
  airAbsorb.connect(panner);
  panner.connect(dry);
  dry.connect(out);
  panner.connect(reverbSend);
  reverbSend.connect(reverbBus);

  return { input, directivity, occlusionLp, occlusionGain, airAbsorb, panner, dry, reverbSend };
}

/** 把一帧空间参数写到处理链上（平滑时间常数由调用方决定） */
export function applyParams(chain: SourceChain, p: SpatialParams, t: number, smooth: number): void {
  const set = (param: AudioParam, v: number) => param.setTargetAtTime(v, t, smooth);
  set(chain.panner.positionX, p.px);
  set(chain.panner.positionY, p.py);
  set(chain.panner.positionZ, p.pz);
  set(chain.airAbsorb.frequency, p.airAbsorbHz);
  set(chain.occlusionLp.frequency, p.occlusionHz);
  set(chain.occlusionGain.gain, p.occlusionGain);
  set(chain.directivity.gain, p.directivityDb);
  set(chain.reverbSend.gain, p.reverbSend);
}

/**
 * 混响总线：两台卷积器乒乓工作。
 * 场景切换时把下一条 IR 装进当前静音的那台，然后交叉淡入淡出，
 * 旧场景的混响尾自然衰减完，不会"咔"一下断掉。
 */
export class ReverbBus {
  readonly input: GainNode;
  private convA: ConvolverNode;
  private convB: ConvolverNode;
  private wetA: GainNode;
  private wetB: GainNode;
  private aActive = true;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.input = ctx.createGain();
    this.convA = ctx.createConvolver();
    this.convB = ctx.createConvolver();
    this.wetA = ctx.createGain();
    this.wetB = ctx.createGain();
    this.wetB.gain.value = 0;
    this.input.connect(this.convA);
    this.input.connect(this.convB);
    this.convA.connect(this.wetA);
    this.convB.connect(this.wetB);
    this.wetA.connect(out);
    this.wetB.connect(out);
  }

  /** 初始场景：直接装进 A */
  init(ir: AudioBuffer, wet: number): void {
    this.convA.buffer = ir;
    this.wetA.gain.value = wet;
    this.wetB.gain.value = 0;
    this.aActive = true;
  }

  /** 在时刻 t 用 fade 秒平滑切到下一条 IR */
  scheduleTransition(ir: AudioBuffer, wet: number, t: number, fade: number): void {
    const showB = this.aActive; // 当前静音的是另一台
    const [convIn, wetIn, wetOut] = showB
      ? [this.convB, this.wetB, this.wetA]
      : [this.convA, this.wetA, this.wetB];
    convIn.buffer = ir; // 静音的那台换 IR，无爆音
    wetIn.gain.setValueAtTime(wetIn.gain.value, t);
    wetIn.gain.linearRampToValueAtTime(wet, t + fade);
    wetOut.gain.setValueAtTime(wetOut.gain.value, t);
    wetOut.gain.linearRampToValueAtTime(0, t + fade);
    this.aActive = !this.aActive;
  }
}
