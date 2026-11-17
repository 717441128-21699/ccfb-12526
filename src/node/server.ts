import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
const DIST_BROWSER = join(__dirname, '..', 'browser');
const PORT = Number(process.env.PORT ?? 5173);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
};

/** 优先 public/，其次编译后的浏览器 ESM（dist/browser） */
const roots = [PUBLIC_DIR, DIST_BROWSER];

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const rel = normalize(urlPath === '/' ? 'index.html' : urlPath.slice(1));
    if (rel.startsWith('..')) {
      res.writeHead(403).end('forbidden');
      return;
    }
    for (const root of roots) {
      const full = join(root, rel);
      try {
        const st = await stat(full);
        if (st.isFile()) {
          const data = await readFile(full);
          res.writeHead(200, { 'Content-Type': MIME[extname(full)] ?? 'application/octet-stream' });
          res.end(data);
          return;
        }
      } catch {
        // 试下一个根
      }
    }
    res.writeHead(404).end('not found');
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).listen(PORT, () => {
  console.log(`双耳混音工作台: http://localhost:${PORT}/`);
});
