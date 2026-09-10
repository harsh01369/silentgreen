/**
 * Bundle the CLI and the library entry with esbuild.
 *
 * TypeScript's bundler resolution lets source use extensionless relative imports,
 * which Node's ESM loader then rejects at runtime. Rather than rewriting every
 * import to carry a .js extension it does not have on disk, the published
 * artefacts are single bundled files. It also means an `npx silentgreen` install,
 * or importing the engine, pulls no runtime dependencies at all.
 */

import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  // Keep the bundles readable: this is a tool that asks people to trust it.
  minify: false,
  sourcemap: false,
  logLevel: 'info',
};

// The CLI.
await build({
  ...common,
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  banner: { js: '#!/usr/bin/env node' },
});

// The engine as a library, for the hosted service and anyone else who wants it.
await build({
  ...common,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
});

// The SDK recorder, as an ergonomic subpath: `silentgreen/record`.
await build({
  ...common,
  entryPoints: ['src/record.ts'],
  outfile: 'dist/record.js',
});
