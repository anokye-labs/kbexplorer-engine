/**
 * Browser shim for `node:path` — only the two helpers the rich-Markdown
 * provider's `./lib` uses (`basename`, `extname`), as pure string ops.
 *
 * Aliased in `vite.config.ts` so `@anokye-labs/kbexplorer-provider-rich-markdown/lib`
 * (which top-level-imports `node:path`) bundles for the browser. Tests run under
 * vitest's `node` environment and use the real builtin (this alias is NOT added
 * to `vitest.config.ts`).
 */

/** Last path segment, optionally dropping a trailing `ext`. */
export function basename(path: string, ext?: string): string {
  let base = String(path);
  const slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
  if (slash >= 0) base = base.slice(slash + 1);
  if (ext && base.endsWith(ext) && base !== ext) {
    base = base.slice(0, base.length - ext.length);
  }
  return base;
}

/** File extension (including the leading dot), or '' when there is none. */
export function extname(path: string): string {
  const base = basename(String(path));
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return ''; // no dot, or leading-dot dotfile
  return base.slice(dot);
}

export default { basename, extname };
