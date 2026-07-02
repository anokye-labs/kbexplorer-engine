/**
 * Minimal access render-gate (#445, spec item 4) over core v0.3.0's
 * label-only access contract ({@link KBAccessLabel}: kbx labels, the host
 * enforces).
 *
 * This template's minimal enforcement: a node whose label marks it sensitive
 * is **withheld** — excluded from the assembled graph (so it never renders)
 * and from the client-side search index. Withheld means:
 *
 *  - `classification` is `restricted`, `confidential`, or (explicitly)
 *    `unknown` — core documents `unknown` as restricted under the
 *    default-safe redaction boundary; or
 *  - `visibility` is `private`.
 *
 * An **absent label means public** (unchanged behavior) — per the spec's
 * minimal slice, only *labeled*-sensitive nodes are gated; core's stricter
 * "withhold unlabeled/unknown by default" boundary and the full
 * redaction-stub contract (`AccessConfig.redactionBoundary` /
 * `commitRedactionStubs`, edge labels, redacted placeholders) are NOT yet
 * enforced here. See the README's "Access labels" honesty note.
 */
import type { KBAccessLabel, KBNode } from '../types';

/** Classifications the gate withholds (case-insensitive). */
const WITHHELD_CLASSIFICATIONS = new Set(['restricted', 'confidential', 'unknown']);

/** Visibility scopes the gate withholds (case-insensitive). */
const WITHHELD_VISIBILITY = new Set(['private']);

/**
 * True when a node's access label marks it sensitive enough to withhold from
 * render + search. Absent label → `false` (public, unchanged).
 */
export function isAccessWithheld(node: Pick<KBNode, 'access'>): boolean {
  const access = node.access;
  if (!access) return false;
  const classification = access.classification?.trim().toLowerCase();
  if (classification && WITHHELD_CLASSIFICATIONS.has(classification)) return true;
  const visibility = access.visibility?.trim().toLowerCase();
  if (visibility && WITHHELD_VISIBILITY.has(visibility)) return true;
  return false;
}

/** Drop withheld nodes from a node list (identity when nothing is labeled). */
export function filterAccessWithheld(nodes: KBNode[]): KBNode[] {
  const kept = nodes.filter(n => !isAccessWithheld(n));
  return kept.length === nodes.length ? nodes : kept;
}

/**
 * Defensively parse an authored-frontmatter `access` value into a
 * {@link KBAccessLabel}. Frontmatter is untrusted: only well-typed
 * `classification` / `visibility` strings and string `labels` survive.
 * Returns `undefined` when nothing usable is present (node stays unlabeled).
 */
export function parseAccessLabel(value: unknown): KBAccessLabel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const label: KBAccessLabel = {};
  if (typeof raw.classification === 'string' && raw.classification.trim()) {
    label.classification = raw.classification.trim();
  }
  if (typeof raw.visibility === 'string' && raw.visibility.trim()) {
    label.visibility = raw.visibility.trim();
  }
  if (Array.isArray(raw.labels)) {
    const labels = raw.labels.filter((l): l is string => typeof l === 'string' && l.trim() !== '');
    if (labels.length > 0) label.labels = labels;
  }
  return Object.keys(label).length > 0 ? label : undefined;
}
