import type { KBConfig } from '@anokye-labs/kbexplorer-core';

/**
 * Minimal, Node-safe default {@link KBConfig} used as `loadConfig`'s fallback
 * when a repo has no `config.yaml` (or it fails to load/parse).
 *
 * kbexplorer-template's equivalent (`DEFAULT_CONFIG` in its local
 * `src/types/index.ts`) reads `import.meta.env.VITE_KB_*` — a Vite-only
 * global that this package's `tests/boundary.test.ts` forbids outside the
 * one exempted sqlite-wasm shim, and one this runtime-agnostic engine
 * package must not depend on regardless (it should run under Node as well as
 * a Vite-bundled browser app). This default therefore reads no environment
 * and carries only neutral, sensible values; callers that need
 * environment-driven overrides (e.g. a `VITE_KB_*`-aware host app) should
 * apply them on top of this before/after `loadConfig` merges its own
 * `config.yaml` values in.
 */
export const DEFAULT_CONFIG: KBConfig = {
  title: 'kbexplorer',
  subtitle: 'Interactive Knowledge Base Explorer',
  author: 'Anokye Labs',
  source: { owner: 'anokye-labs', repo: 'kbexplorer', path: 'content', branch: 'main' },
  clusters: {
    feature: { name: 'Feature', color: '#4A9CC8' },
    task: { name: 'Task', color: '#8CB050' },
    bug: { name: 'Bug', color: '#C04040' },
    epic: { name: 'Epic', color: '#E8A838' },
    code: { name: 'Code', color: '#9A8A78' },
    docs: { name: 'Documentation', color: '#D4A050' },
    infra: { name: 'Infrastructure', color: '#5A98A8' },
    default: { name: 'Default', color: '#8B949E' },
  },
  visuals: {
    mode: 'emoji',
    fallback: 'emoji',
  },
  theme: {
    default: 'dark',
  },
  graph: {
    physics: true,
    layout: 'force-atlas-2',
  },
  features: {
    hud: true,
    minimap: true,
    readingTools: true,
    keyboardNav: true,
    sparkAnimation: true,
  },
};
