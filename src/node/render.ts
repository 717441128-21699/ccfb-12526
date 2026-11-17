#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadProject, renderProject } from '../io/renderProject.js';

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]!;
    const val = argv[i + 1] ?? '';
    if (key.startsWith('--')) args.set(key.slice(2), val);
  }
  return args;
}

const args = parseArgs(process.argv);
const projectPath = args.get('project');
const out = args.get('out');
if (!projectPath || !out) {
  console.error(
    '用法: npm run render -- --project <工程.json> --out <输出.wav> [--bits 24] [--masterDb -1]',
  );
  process.exit(1);
}

const { project, projectDir } = loadProject(resolve(projectPath));
console.log(`工程: ${project.name}  时长: ${project.duration.toFixed(1)}s  声部: ${project.sources.length}`);

const result = renderProject(project, projectDir, resolve(out), {
  bits: (Number(args.get('bits') ?? 24) as 16 | 24 | 32) || 24,
  masterDb: Number(args.get('masterDb') ?? 0),
  onProgress: (frac, elapsed) => {
    process.stdout.write(`\r渲染中 ${(frac * 100).toFixed(1)}%  已用 ${elapsed.toFixed(1)}s`);
  },
});

console.log('');
console.log(
  `完成: ${resolve(out)}\n` +
    `节目时长 ${result.durationSeconds.toFixed(1)}s，渲染耗时 ${result.renderSeconds.toFixed(2)}s，` +
    `速度 ${result.speedFactor.toFixed(1)}x（实时倍率）`,
);
