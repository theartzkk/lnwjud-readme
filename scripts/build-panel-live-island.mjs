import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const output = resolve(process.argv[2] || 'dist-web');
await mkdir(output, { recursive: true });

await build({
  entryPoints: [resolve(root, 'web/panel-live-island/index.tsx')],
  outfile: resolve(output, 'panel-live-ui.js'),
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
});
console.log('AWH Control Panel live island built');
