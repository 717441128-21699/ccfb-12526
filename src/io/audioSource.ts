/**
 * 平台无关的音频素材读取接口。
 * Node 端为流式 WAV 读取器（按块 seek/read，不全量载入），
 * 浏览器实时端为 AudioBuffer 包装，离线导出端复用 Node 读取器。
 */
export interface AudioSource {
  readonly id: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: number;
  /**
   * 读取从 frame 开始的 n 个单声道帧到 out（多声道素材在此下混）。
   * 超出素材范围的部分写 0。返回实际写入帧数。
   */
  readBlock(frame: number, n: number, out: Float32Array): number;
}
