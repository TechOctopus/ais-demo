// Production build webového rozhrania (src/web → dist/web) priamo cez esbuild.
// Vite 7 nevie pracovať s UNC cestami (\\psf\… v Parallels, sieťové disky): mení ich na C:\psf\….
// esbuild ich spracuje správne, takže `npm run build` funguje aj na zdieľanom priečinku.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = path.join(root, 'src', 'web');
const outDir = path.join(root, 'dist', 'web');

// STATIC_BASE=/ais-demo/ → statická verzia pre GitHub Pages: server beží v prehliadači (src/static/sandbox-worker.ts).
const staticBase = process.env.STATIC_BASE;
const base = staticBase ? `/${staticBase.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/') : '/';

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let workerUrl = '';
if (staticBase) {
  const w = await build({
    absWorkingDir: root,
    entryPoints: [path.join(root, 'src', 'static', 'sandbox-worker.ts')],
    outdir: path.join(outDir, 'assets'),
    entryNames: '[name]-[hash]',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    alias: { express: path.join(root, 'src', 'static', 'express-shim.ts') },
    metafile: true,
    logLevel: 'warning',
  });
  workerUrl = `${base}assets/${path.basename(Object.keys(w.metafile.outputs)[0])}`;
}

const result = await build({
  absWorkingDir: root,
  entryPoints: [path.join(webSrc, 'main.tsx')],
  outdir: path.join(outDir, 'assets'),
  entryNames: '[name]-[hash]',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  define: {
    'process.env.NODE_ENV': '"production"',
    __STATIC__: JSON.stringify(Boolean(staticBase)),
    __BASE__: JSON.stringify(base),
    __WORKER_URL__: JSON.stringify(workerUrl),
  },
  metafile: true,
  logLevel: 'warning',
});

const outputs = Object.keys(result.metafile.outputs).map((p) => path.basename(p));
const js = outputs.find((f) => f.endsWith('.js'));
const css = outputs.find((f) => f.endsWith('.css'));
if (!js) throw new Error('esbuild nevytvoril JavaScript bundle');

const html = readFileSync(path.join(webSrc, 'index.html'), 'utf8')
  .replace(
    /<script type="module" src="\.\/main\.tsx"><\/script>/,
    `<script type="module" src="${base}assets/${js}"></script>`,
  )
  .replace('</head>', css ? `    <link rel="stylesheet" href="${base}assets/${css}" />\n  </head>` : '</head>');
writeFileSync(path.join(outDir, 'index.html'), html);
if (staticBase) {
  // GitHub Pages nemá server: každá stránka (/cpo, /emsp, /hub) dostane vlastný index.html.
  for (const page of ['cpo', 'emsp', 'hub']) {
    mkdirSync(path.join(outDir, page), { recursive: true });
    writeFileSync(path.join(outDir, page, 'index.html'), html);
  }
  writeFileSync(path.join(outDir, '404.html'), html);
  writeFileSync(path.join(outDir, '.nojekyll'), '');
}

for (const [file, info] of Object.entries(result.metafile.outputs)) {
  console.log(`  dist/web/assets/${path.basename(file)}  ${(info.bytes / 1024).toFixed(1)} kB`);
}
if (workerUrl) console.log(`  ${workerUrl}  (server v prehliadači)`);
console.log(`✓ webové rozhranie zostavené do dist/web${staticBase ? ` (statická verzia, základ ${base})` : ''}`);
