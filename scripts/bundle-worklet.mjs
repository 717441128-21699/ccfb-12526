/**
 * 零依赖 ESM 打包器（本项目专用）。
 * 思路：用 Node 的 module 解析得到可靠依赖图；每个模块包成 IIFE，
 * import 改写为对依赖命名空间的解构，export 收集到模块命名空间对象。
 * 支持：相对静态 import、import type（剥离）、export class/function/const、export { }。
 * 用途：把 AudioWorklet 处理器及其 DSP 依赖打成单文件 ESM 供 addModule 加载。
 *
 * 用法: node bundle-worklet.mjs <entry.js> <out.js>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = resolve(process.argv[2] ?? '');
const outFile = resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) {
  console.error('用法: node bundle-worklet.mjs <entry.js> <out.js>');
  process.exit(1);
}

/** 解析一个模块的静态依赖（仅相对路径） */
function parseImports(abs, code) {
  const deps = [];
  const re = /import\s+(?:type\s+)?([\w*{},\s]+?)\s+from\s+['"]([^'"]+)['"];?/g;
  let m;
  while ((m = re.exec(code))) {
    const names = m[1].trim();
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    deps.push({ names, spec, abs: resolve(dirname(abs), spec) });
  }
  return deps;
}

// ---- 构建依赖图（拓扑序，依赖在前）----
const graph = new Map();
const order = [];
function walk(abs) {
  if (graph.has(abs)) return;
  const code = readFileSync(abs, 'utf8');
  const deps = parseImports(abs, code);
  graph.set(abs, { code, deps });
  for (const d of deps) walk(d.abs);
  order.push(abs);
}
walk(entry);

const nsOf = new Map();
order.forEach((abs, i) => nsOf.set(abs, `__mod${i}`));

function rewriteImports(code, deps) {
  return code.replace(
    /import\s+(?:type\s+)?([\w*{},\s]+?)\s+from\s+['"]([^'"]+)['"];?/g,
    (whole, namesRaw, spec) => {
      if (spec.startsWith('import type') || namesRaw === undefined) return '';
      const dep = deps.find((d) => d.spec === spec);
      if (!dep) return whole;
      const ns = nsOf.get(dep.abs);
      const names = namesRaw.trim();
      if (names.startsWith('*')) {
        const alias = names.replace(/^\*\s+as\s+/, '').trim();
        return `const ${alias} = ${ns};`;
      }
      const binds = names
        .replace(/[{}]/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const p = s.split(/\s+as\s+/);
          return p.length === 2 ? `${p[0].trim()}: ${p[1].trim()}` : s;
        })
        .join(', ');
      return `const { ${binds} } = ${ns};`;
    },
  );
}

function rewriteExports(code) {
  const exported = new Set();
  // export class/function/const/let/var NAME
  let out = code.replace(/export\s+(class|function|const|let|var)\s+(\w+)/g, (_m, kind, name) => {
    exported.add(name);
    return `${kind} ${name}`;
  });
  // export { a, b as c }
  const aliasExports = [];
  out = out.replace(/export\s*\{([^}]*)\};?/g, (_m, inner) => {
    for (let part of inner.split(',')) {
      part = part.trim();
      if (!part) continue;
      const p = part.split(/\s+as\s+/).map((x) => x.trim());
      const local = p[0];
      const ext = p[1] ?? p[0];
      exported.add(local);
      aliasExports.push(`${ext}: ${local}`);
    }
    return '';
  });
  return { out, exported: [...exported], aliasExports };
}

const chunks = ['// 自动生成的单文件 ESM（AudioWorklet 打包产物，勿手改）'];
for (const abs of order) {
  const mod = graph.get(abs);
  const ns = nsOf.get(abs);
  let code = rewriteImports(mod.code, mod.deps);
  const isEntry = pathToFileURL(abs).href === pathToFileURL(entry).href;

  if (isEntry) {
    chunks.push(`// ---- entry: ${abs} ----\n${code}`);
    continue;
  }
  const { out, exported, aliasExports } = rewriteExports(code);
  const assigns = [...exported.map((n) => n), ...aliasExports].join(', ');
  chunks.push(
    `const ${ns} = {};\n(() => {\n${out}\n` +
      `Object.assign(${ns}, { ${assigns} });\n})();`,
  );
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, chunks.join('\n\n'), 'utf8');
console.log(`已打包 ${entry} → ${outFile}（${order.length} 个模块）`);
