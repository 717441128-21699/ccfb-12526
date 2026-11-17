import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { renderProject } from './dist/io/renderProject.js';
import { buildStressProject, buildDemoProject } from './dist/node/demo.js';

// 1) 40 分钟硬指标
const p = buildStressProject('workdir');
const t0 = performance.now();
const r = renderProject(p, 'workdir', 'workdir/final-40min.wav', {});
const wall = (performance.now()-t0)/1000;
console.log(`[1] 40分钟/20声部: ${wall.toFixed(1)}s ${wall<=180?'✓达标':'✗超标'} (${r.speedFactor.toFixed(1)}x)`);

// 2) demo 削波检查（读 24-bit 输出）
const { project, dir } = buildDemoProject('workdir');
renderProject(project, dir, dir+'/final-demo.wav', {});
const buf = readFileSync(dir+'/final-demo.wav');
const bps = buf.readUInt16LE(34)/8, frames=(buf.length-44)/(2*bps);
let peak=0;
for(let i=0;i<frames;i++){
  // 24-bit
  const off=44+i*6;
  const l=Math.abs(buf.readIntLE(off,3))/8388608;
  const rr=Math.abs(buf.readIntLE(off+3,3))/8388608;
  peak=Math.max(peak,l,rr);
}
console.log(`[2] demo 峰值 ${peak.toFixed(4)} (应<0.98) ${peak<0.98?'✓':'✗削波'}`);
