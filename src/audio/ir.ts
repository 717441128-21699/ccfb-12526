import type { RoomPreset } from '../model/types';

/**
 * 程序化生成双耳混响脉冲响应（IR）：
 * 前段是按房间尺度排布的离散早期反射，后段是指数衰减噪声混响尾。
 * 左右耳用不相关的噪声，保证空间宽度。
 * 不需要外部 IR 文件；后续可换成真实房间 IR / SOFA 数据。
 */
export function makeImpulseResponse(
  ctx: BaseAudioContext,
  preset: RoomPreset,
  seed = 1,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const preDelay = Math.max(0, preset.preDelayMs / 1000);
  // 早期反射窗：一阶反射到达时间 ≈ 房间尺度 / 声速
  const erWindow = Math.max(0.02, preset.roomSize / 340);
  const tail = Math.max(0.05, preset.rt60);
  const len = Math.ceil((preDelay + erWindow + tail * 1.2) * sr);
  const buf = ctx.createBuffer(2, len, sr);

  let s = seed >>> 0 || 1;
  const rand = () => {
    // xorshift32：可复现，离线渲染和预览用同一条 IR
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 0xffffffff * 2 - 1;
  };

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const erEnd = Math.floor((preDelay + erWindow) * sr);
    // 早期反射：8 个指数衰减的离散反射点，间隔随房间尺度拉开
    const taps = 8;
    for (let i = 0; i < taps; i++) {
      const tNorm = (i + 1) / taps;
      const idx = Math.floor((preDelay + tNorm * erWindow) * sr);
      if (idx >= len) break;
      const amp = Math.pow(1 - tNorm, 1.5) * 0.7;
      const width = Math.max(1, Math.floor(sr * 0.0015));
      for (let k = 0; k < width && idx + k < len; k++) {
        data[idx + k] += amp * rand() * (1 - k / width);
      }
    }
    // 混响尾：指数衰减噪声 + 高频阻尼（一阶低通的指数谱近似）
    const decay = 6.91 / Math.max(0.05, tail); // RT60 -> 指数衰减率
    const damp = 1 - preset.damping * 0.9;
    let lp = 0;
    for (let i = erEnd; i < len; i++) {
      const t = (i - erEnd) / sr;
      const env = Math.exp(-decay * t);
      lp = lp * damp + rand() * (1 - damp); // 简易低通让尾巴变闷
      data[i] += lp * env * 0.5;
    }
  }
  return buf;
}
