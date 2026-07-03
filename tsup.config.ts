import { createRequire } from 'node:module';

import { defineConfig } from 'tsup';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

export default defineConfig({
  // All slice-1 pipeline-core modules (access, glob, graph, identity,
  // nodemap, parser, safe-markdown, source-edit, structured-content,
  // structured-node-map, transforms, node-types/, edge-weights,
  // default-config, github-types, env) are re-exported from src/index.ts and
  // are bundled transitively — they don't need their own entry points.
  entry: ['src/index.ts', 'src/sources.ts', 'src/store.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  treeshake: true,
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
