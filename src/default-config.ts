import type { KBConfig } from '@anokye-labs/kbexplorer-core';

/**
 * Minimal, Node-safe default {@link KBConfig} used as `loadConfig`'s fallback
 * when a repo has no `config.yaml` (or it fails to load/parse).
 *
 * This is kept field-for-field identical to kbexplorer-template's
 * `DEFAULT_CONFIG` (`src/types/index.ts`), with exactly one disclosed,
 * intentional difference: template's `title` and `source` fields are backed
 * by a Vite build-time env-injection read (`VITE_KB_TITLE`/`VITE_KB_OWNER`/
 * `VITE_KB_REPO`/`VITE_KB_BRANCH`/`VITE_KB_PATH`, via `resolveDefaultSource`)
 * that this package's `tests/boundary.test.ts` forbids and that this
 * runtime-agnostic engine package must not depend on regardless (it should
 * run under Node as well as a Vite-bundled browser app). Both fields here use
 * exactly the same *fallback* values template's own functions already fall
 * back to when those env vars are unset, so a repo with no Vite env
 * configured gets byte-identical behavior either way. Callers that need
 * environment-driven overrides (e.g. a `VITE_KB_*`-aware host app) should
 * apply them on top of this before/after `loadConfig` merges its own
 * `config.yaml` values in.
 *
 * `src/__tests__/default-config.test.ts` asserts this stays in sync with
 * template's `DEFAULT_CONFIG` (minus the one disclosed exception above) so
 * future drift between the two repos is caught by CI instead of silently
 * propagating once slice 4 wires `loadConfig` to this fallback.
 */
export const DEFAULT_CONFIG: KBConfig = {
  title: 'kbexplorer',
  subtitle: 'Interactive Knowledge Base Explorer',
  author: 'Anokye Labs',
  source: { owner: 'anokye-labs', repo: 'kbexplorer', path: 'content', branch: 'main' },
  clusters: {
    // Each cluster may also carry an optional `tokens` delta (Fluent token name
    // → CSS value, same shape as theme.tokens) to shift only that cluster's
    // scoped surfaces (cards/badges/reading header). Omitted here so defaults
    // inherit the active global theme unchanged.
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
    // brand / tokens / themes are optional, additive overrides (see KBConfig.theme).
    // Left unset by default so the built-in dark/light/sepia themes are unchanged.
    // themesFile (also unset by default) may point at a dedicated theme file in the
    // host repo (e.g. "content/themes/extra.yaml"); when set it is fetched at runtime
    // like config.yaml and its named themes are merged into the THEME_MAP, overriding
    // any inline theme.themes of the same name. Unset means no fetch, no behavior change.
    // moduleUrl (also unset by default) is the most powerful escape hatch: a
    // security-sensitive opt-in that dynamically import()s a host-provided ESM JS
    // module exporting a Fluent Theme / BrandVariants and registers it into the
    // THEME_MAP. Off by default, meaning no import, pure no-op. Only set it for a
    // module you trust (ideally self-hosted in this repo) and tighten CSP accordingly
    // — see the theming docs' CSP note.
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
  // branding omitted by default — host repos may set branding.logo (a repo-relative
  // image path) to render a logo on the HomePage hero and HUD header, and
  // branding.favicon (a repo-relative image path) to swap the favicon at
  // runtime, and branding.css (a repo-relative path or URL) to inject a raw CSS
  // override sheet last in <head> for full control over --colorNeutral*/
  // --colorBrand*/--kbe-* variables. Text title and the static /favicon.svg are
  // used as graceful fallbacks; branding.css is unset by default so nothing is
  // injected.
};
