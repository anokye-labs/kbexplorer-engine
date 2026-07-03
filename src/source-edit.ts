/**
 * Source-of-truth editing + GitHub PR write-back handoff (F5 — issue #152).
 *
 * kbexplorer is a static, **secret-free** Azure Static Web App: it cannot (and
 * must not) hold a GitHub token or write to git from the browser. So instead of
 * committing edits itself, the in-app editor edits a node's underlying
 * source-of-truth file (the real YAML/JSON entity file — never the JSON-LD
 * projection, so F2's mappings stay pure & reversible) and hands the change off
 * to GitHub's own **authenticated** web UI:
 *
 *   - **existing file** → the GitHub web editor (`…/edit/<branch>/<path>`); the
 *     user pastes the edited content (copied to their clipboard) and commits to a
 *     new branch + PR.
 *   - **new file** → GitHub's create-file page (`…/new/<branch>?filename=&value=`)
 *     pre-filled with the path + edited content.
 *   - a downloadable unified-diff **`.patch`** is offered as a portable fallback.
 *
 * Everything here is a **pure function** (no DOM, no network, no secrets) so it
 * is trivially unit-testable and safe to call from the render path.
 */
import yaml from 'yaml';
import type { KBConfig, KBNode, NodeSourceFile } from '@anokye-labs/kbexplorer-core';

/** GitHub repository coordinates needed to build deep links. */
export interface RepoCoords {
  owner: string;
  repo: string;
  branch: string;
}

/** Resolve repo coordinates from the app config (branch defaults to `main`). */
export function repoCoordsFromConfig(config: Pick<KBConfig, 'source'>): RepoCoords {
  const { owner, repo, branch } = config.source;
  return { owner, repo, branch: branch && branch.trim() ? branch : 'main' };
}

/**
 * Whether a node exposes an editable source-of-truth file. This is the single
 * gate for the editor affordance: nodes without a resolvable writable file
 * (README, derived, structural, unresolved stubs…) return `false`, so the
 * editor simply never appears for them — a safe no-op.
 */
export function canEditSource(node: Pick<KBNode, 'sourceFile'>): boolean {
  const f = node.sourceFile;
  return (
    !!f &&
    typeof f.path === 'string' &&
    f.path.trim().length > 0 &&
    typeof f.raw === 'string' &&
    // Validate the runtime `format` too: cached/loaded data could carry a
    // missing or unknown format, which would later crash the editor
    // (`format.toUpperCase()`) or mis-dispatch validation. An invalid shape
    // simply exposes no affordance — a safe no-op.
    (f.format === 'yaml' || f.format === 'json')
  );
}

/** Return a node's source-of-truth file pointer, or `null` when it has none. */
export function resolveSourceFile(node: Pick<KBNode, 'sourceFile'>): NodeSourceFile | null {
  return canEditSource(node) ? (node.sourceFile as NodeSourceFile) : null;
}

/** Result of validating edited source content against its declared format. */
export type ValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Normalise newlines to `\n`. Files checked out on Windows carry CRLF while a
 * browser `<textarea>` always emits LF, so comparisons and diffs must be
 * newline-agnostic — otherwise a one-line edit looks like a whole-file rewrite.
 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/**
 * Validate that edited content parses as its declared format **before** any
 * handoff, so a user never opens a PR carrying invalid YAML/JSON. Empty content
 * is rejected (an entity file must contain a document). `markdown` is accepted
 * as always-valid (there is nothing to parse) — `canEditSource` currently only
 * surfaces the editor for `yaml`/`json`, but accepting the full
 * `NodeSourceFile['format']` union keeps this forward-compatible and total.
 */
export function validateSourceContent(
  raw: string,
  format: NodeSourceFile['format'],
): ValidationResult {
  if (raw.trim().length === 0) {
    return { ok: false, error: 'Source file is empty.' };
  }
  try {
    if (format === 'json') {
      JSON.parse(raw);
    } else if (format === 'yaml') {
      // `yaml.parse` throws on malformed YAML; a valid scalar/null is allowed.
      yaml.parse(raw);
    }
    // `markdown` (and any future text format): non-empty content is valid.
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ── GitHub deep-link construction ──────────────────────────

const GITHUB_WEB = 'https://github.com';

/** Encode a repo-relative path for use inside a URL path (segment-wise). */
export function encodeRepoPath(path: string): string {
  return path
    .split('/')
    .filter(seg => seg.length > 0)
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

/**
 * GitHub web-editor URL for an **existing** file. Opening it shows GitHub's
 * authenticated editor for the current file; the user pastes the edited content
 * and commits it to a new branch + PR.
 */
export function buildEditUrl(coords: RepoCoords, path: string): string {
  const { owner, repo, branch } = coords;
  return `${GITHUB_WEB}/${owner}/${repo}/edit/${encodeURIComponent(branch)}/${encodeRepoPath(path)}`;
}

/**
 * GitHub create-file URL for a **new** file, pre-filled with the target path and
 * the edited content via the `filename` + `value` query params. GitHub commits
 * it to a new branch and offers to open a PR.
 */
export function buildNewFileUrl(coords: RepoCoords, path: string, content: string): string {
  const { owner, repo, branch } = coords;
  const params = new URLSearchParams({ filename: path, value: content });
  return `${GITHUB_WEB}/${owner}/${repo}/new/${encodeURIComponent(branch)}?${params.toString()}`;
}

/**
 * Pick the correct GitHub deep link for the handoff: the create-file URL
 * (content pre-filled) when the file is new, otherwise the web-editor URL for
 * the existing file.
 */
export function buildHandoffUrl(
  coords: RepoCoords,
  path: string,
  content: string,
  exists: boolean,
): string {
  return exists ? buildEditUrl(coords, path) : buildNewFileUrl(coords, path, content);
}

// ── Unified diff (downloadable `.patch` fallback) ──────────

interface DiffOp {
  type: ' ' | '-' | '+';
  line: string;
}

/** Split text into lines, dropping the synthetic trailing entry for a final newline. */
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Above this line count on either side we skip the O(m·n) LCS table (which
 * would cost megabytes and stall the render path) and fall back to a coarse
 * "replace everything" diff. Entity files are tiny, so the precise LCS path is
 * the norm; only a pathologically large file ever trips the guard.
 */
const MAX_DIFF_LINES = 5000;

/** Longest-common-subsequence line diff (sufficient for small entity files). */
function diffLines(a: string[], b: string[]): DiffOp[] {
  const m = a.length;
  const n = b.length;
  // Size guard: an O(m·n) DP table is fine for small entity files but would
  // blow up time/memory on a large one. Emit a valid (if coarse) replace-all
  // diff instead of allocating the table.
  if (m > MAX_DIFF_LINES || n > MAX_DIFF_LINES) {
    const coarse: DiffOp[] = [];
    for (const line of a) coarse.push({ type: '-', line });
    for (const line of b) coarse.push({ type: '+', line });
    return coarse;
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: '-', line: a[i] });
      i++;
    } else {
      ops.push({ type: '+', line: b[j] });
      j++;
    }
  }
  while (i < m) ops.push({ type: '-', line: a[i++] });
  while (j < n) ops.push({ type: '+', line: b[j++] });
  return ops;
}

/**
 * Build a git-style unified diff for the change, suitable for downloading as a
 * `.patch`. Returns an empty string when nothing changed.
 *
 * Pass `isNew` for a file that does not yet exist in the repo so the patch uses
 * the git new-file headers (`new file mode` + `--- /dev/null`); a patch with
 * `--- a/<path>` for a non-existent file would fail to apply.
 */
export function buildUnifiedDiff(
  path: string,
  oldText: string,
  newText: string,
  context = 3,
  isNew = false,
): string {
  if (oldText === newText) return '';
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = diffLines(a, b);
  const n = ops.length;

  // Old/new line number that each op refers to (1-based).
  const oldAt = new Array<number>(n);
  const newAt = new Array<number>(n);
  let oldNo = 1;
  let newNo = 1;
  for (let k = 0; k < n; k++) {
    oldAt[k] = oldNo;
    newAt[k] = newNo;
    if (ops[k].type === ' ') {
      oldNo++;
      newNo++;
    } else if (ops[k].type === '-') {
      oldNo++;
    } else {
      newNo++;
    }
  }

  // Collect hunk ranges (change runs padded with `context` lines), then merge overlaps.
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < n) {
    if (ops[i].type === ' ') {
      i++;
      continue;
    }
    let end = i + 1;
    let gap = 0;
    let j = i + 1;
    while (j < n) {
      if (ops[j].type !== ' ') {
        end = j + 1;
        gap = 0;
      } else {
        gap++;
        if (gap > 2 * context) break;
      }
      j++;
    }
    ranges.push([Math.max(0, i - context), Math.min(n, end + context)]);
    i = j;
  }
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const hunks: string[] = [];
  for (const [s, e] of merged) {
    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (let k = s; k < e; k++) {
      const o = ops[k];
      if (o.type === ' ') {
        oldCount++;
        newCount++;
        body.push(` ${o.line}`);
      } else if (o.type === '-') {
        oldCount++;
        body.push(`-${o.line}`);
      } else {
        newCount++;
        body.push(`+${o.line}`);
      }
    }
    const oldStart = oldCount === 0 ? oldAt[s] - 1 : oldAt[s];
    const newStart = newCount === 0 ? newAt[s] - 1 : newAt[s];
    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${body.join('\n')}`);
  }

  const fromPath = isNew ? '/dev/null' : `a/${path}`;
  const newFileLine = isNew ? 'new file mode 100644\n' : '';
  const header = `diff --git a/${path} b/${path}\n${newFileLine}--- ${fromPath}\n+++ b/${path}\n`;
  return `${header}${hunks.join('\n')}\n`;
}

/** Suggested filename for a downloaded `.patch` (basename of the source file). */
export function patchFilename(path: string): string {
  const base = path.split('/').filter(Boolean).pop() ?? 'source';
  return `${base}.patch`;
}

/** Everything the UI needs to hand a source edit off to GitHub. */
export interface SourceEditHandoff {
  /** Whether the edited content differs from the original. */
  changed: boolean;
  /** Whether the source file already exists in the repo. */
  exists: boolean;
  /** Primary GitHub deep link to open the change as a PR. */
  url: string;
  /** GitHub web-editor URL for the existing file. */
  editUrl: string;
  /** GitHub create-file URL pre-filled with the edited content. */
  newFileUrl: string;
  /** Unified diff suitable for a downloadable `.patch` (empty when unchanged). */
  patch: string;
  /** Suggested filename for the downloaded patch. */
  patchName: string;
}

/**
 * Assemble the full handoff for an edited source file. `exists` defaults to
 * `true` because the editor edits files that were loaded from the repo; pass
 * `false` for a brand-new entity so the content-pre-filled create-file URL is
 * used as the primary link.
 */
export function buildSourceEditHandoff(
  coords: RepoCoords,
  file: NodeSourceFile,
  newContent: string,
  exists = true,
): SourceEditHandoff {
  // Compare/diff against newline-normalised text so a CRLF checkout doesn't make
  // every line look changed; the content handed to GitHub uses LF (its default).
  const base = normalizeNewlines(file.raw);
  const next = normalizeNewlines(newContent);
  return {
    changed: next !== base,
    exists,
    url: buildHandoffUrl(coords, file.path, next, exists),
    editUrl: buildEditUrl(coords, file.path),
    newFileUrl: buildNewFileUrl(coords, file.path, next),
    patch: buildUnifiedDiff(file.path, base, next, 3, !exists),
    patchName: patchFilename(file.path),
  };
}
