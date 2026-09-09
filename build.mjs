/**
 * Bundle the CLI with esbuild.
 *
 * TypeScript's bundler resolution lets source use extensionless relative imports,
 * which Node's ESM loader then rejects at runtime. Rather than rewriting every
 * import to carry a .js extension it does not have on disk, the published
 * artefact is a single bundled file. It also means an `npx silentgreen` install
 * pulls no runtime dependencies at all.
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  // Keep the bundle readable: this is a tool that asks people to trust it.
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});
