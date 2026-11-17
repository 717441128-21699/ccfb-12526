/**
 * AudioWorklet 全局作用域环境声明。
 * worklet 处理器运行在 AudioWorkletGlobalScope，而非主线程 window，
 * 这里声明其全局类与函数，供 binaural-worklet.ts 类型检查。
 */

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

interface AudioWorkletProcessorCtor {
  new (): AudioWorkletProcessor;
}

declare function registerProcessor(name: string, ctor: AudioWorkletProcessorCtor): void;

// worklet 内的全局只读采样率
declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;
