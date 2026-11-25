import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, normalize } from 'node:path';
import { Miniflare } from 'miniflare';

const root = process.cwd();
const outDir = resolve(root, '.cloudflare/output/v0/workers/default');
const assetsDir = resolve(outDir, 'assets');
const cfg = JSON.parse(readFileSync(resolve(outDir, 'worker.config.json'), 'utf8'));

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const cleanConfig = { ...cfg };
delete cleanConfig.assets;
delete cleanConfig.observability;
if (cleanConfig.env?.ASSETS) {
  cleanConfig.env = { ...cleanConfig.env };
  delete cleanConfig.env.ASSETS;
}

const mf = new Miniflare({
  resourcePersistencePath: resolve(root, '.cloudflare/state/v3'),
  workers: [
    {
      config: {
        ...cleanConfig,
        compatibilityDate: '2026-09-21',
        manifest: {
          mainModule: 'index.js',
          modules: {
            'index.js': {
              type: 'esm',
              contents: readFileSync(resolve(outDir, 'bundle/index.js'), 'utf8'),
            },
          },
        },
      },
      dev: {
        rootPath: outDir,
      },
    },
  ],
});

await mf.ready;

const server = createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://${host}:${port}`);
    if (reqUrl.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const mfRes = await mf.dispatchFetch(reqUrl.toString(), {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });
      res.writeHead(mfRes.status, Object.fromEntries(mfRes.headers.entries()));
      const buf = Buffer.from(await mfRes.arrayBuffer());
      res.end(buf);
      return;
    }

    const safePath = normalize(decodeURIComponent(reqUrl.pathname)).replace(/^([/\\])+/, '');
    let filePath = resolve(assetsDir, safePath || 'index.html');
    if (!filePath.startsWith(assetsDir) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = resolve(assetsDir, 'index.html');
    }
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(readFileSync(filePath));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(err));
  }
});

server.listen(port, host, () => {
  console.log(`BudgetLens local Worker preview ready at http://${host}:${port}/`);
});

const shutdown = async () => {
  server.close();
  await mf.dispose();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
