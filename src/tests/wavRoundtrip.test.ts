import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WavWriter } from '../io/wavWriter.js';
import { WavFileSource } from '../io/wavReader.js';

const dir = mkdtempSync(join(tmpdir(), 'wav-rt-'));

test.after(() => rmSync(dir, { recursive: true, force: true }));

for (const bits of [16, 24, 32] as const) {
  test(`WAV ${bits}-bit 立体声写入/读取往返无削波且长度精确`, () => {
    const path = join(dir, `rt${bits}.wav`);
    const sr = 48000;
    const frames = 5000;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      // 含正负值与较大幅度，验证符号与量化
      left[i] = 0.4 * Math.sin(2 * Math.PI * 440 * (i / sr));
      right[i] = 0.3 * Math.cos(2 * Math.PI * 660 * (i / sr));
    }
    const writer = new WavWriter(path, sr, bits);
    // 分两次写，验证多块追加与偏移管理
    writer.writeStereo(left.subarray(0, 3000), right.subarray(0, 3000));
    writer.writeStereo(left.subarray(3000), right.subarray(3000));
    writer.close();

    const src = new WavFileSource('rt', path);
    assert.equal(src.sampleRate, sr);
    assert.equal(src.channels, 2);
    assert.equal(src.frames, frames, '帧数应与写入完全一致（文件长度精确）');

    const out = new Float32Array(frames);
    src.readBlock(0, frames, out);
    let peak = 0;
    let errSum = 0;
    for (let i = 0; i < frames; i++) {
      // 立体声下混：(L+R)/2
      const expected = (left[i]! + right[i]!) / 2;
      errSum += Math.abs(out[i]! - expected);
      peak = Math.max(peak, Math.abs(out[i]!));
    }
    const meanErr = errSum / frames;
    // 容差随位深放宽；Float32 正弦生成本身带 ~1e-7 级误差，32bit 取固定下限
    const tolerance =
      bits === 16 ? 1 / 32768 : bits === 24 ? 1 / 8388608 : 1 / 2147483648;
    const factor = bits === 32 ? 200 : 2;
    assert.ok(meanErr < tolerance * factor, `${bits}bit 平均量化误差 ${meanErr} 应 < ${tolerance * factor}`);
    assert.ok(peak < 0.5, '不应削波');
    assert.ok(peak > 0.01, '不应为静音');
    src.close();
  });
}

test('读取越界返回静音且不抛错', () => {
  const path = join(dir, 'edge.wav');
  const sr = 48000;
  const w = new WavWriter(path, sr, 16);
  const sig = new Float32Array(100).fill(0.2);
  w.writeStereo(sig, sig);
  w.close();
  const src = new WavFileSource('e', path);
  const out = new Float32Array(200);
  // 从第 80 帧读 200 帧：前 20 有效，后 180 静音
  src.readBlock(80, 200, out);
  assert.ok(Math.abs(out[10]!) > 0, '有效区应有信号');
  for (let i = 120; i < 200; i++) assert.equal(out[i], 0, '越界区应为 0');
  src.close();
});
