import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../default-config';

/**
 * Asserts `DEFAULT_CONFIG` stays field-for-field identical to
 * kbexplorer-template's `DEFAULT_CONFIG` (`src/types/index.ts`), with only
 * the one disclosed, intentional exception: `title` and `source` here are
 * hardcoded to the same *fallback* values template's own `resolveDefaultSource`
 * and inline `title` expression already fall back to when their Vite env
 * vars (`VITE_KB_TITLE`/`VITE_KB_OWNER`/`VITE_KB_REPO`/`VITE_KB_BRANCH`/
 * `VITE_KB_PATH`) are unset — this package cannot read those env vars (see
 * `tests/boundary.test.ts`).
 *
 * If this test starts failing after a template update, re-pull template's
 * current `DEFAULT_CONFIG` and reconcile the diff here (and in
 * `../default-config.ts`) rather than just updating the assertion — a
 * failure here means the two repos' fallback configs have drifted apart.
 */
describe('DEFAULT_CONFIG — parity with kbexplorer-template', () => {
  it('matches template DEFAULT_CONFIG in every field except the disclosed title/source env-fallback exception', () => {
    expect(DEFAULT_CONFIG).toEqual({
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
        'pull-request': { name: 'Pull Request', color: '#A86FDF' },
        commits: { name: 'Commits', color: '#5A98A8' },
        releases: { name: 'Releases', color: '#F78166' },
      },
      visuals: {
        mode: 'emoji',
        fallback: 'emoji',
      },
      theme: {
        default: 'dark',
        font: {
          heading: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
          body: "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
          mono: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
        },
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
        sparkAnimation: false,
        search: true,
      },
    });
  });
});
