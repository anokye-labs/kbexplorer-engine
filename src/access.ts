/**
 * Minimal access render-gate (#445, spec item 4) over core's hoisted access
 * exclusion contract.
 *
 * This template's minimal enforcement still withholds labeled-sensitive nodes
 * from the assembled graph and search index. We preserve one deliberate
 * template-only difference versus core's default-safe boundary: bespoke
 * classifications such as `bespoke-scheme` remain non-withheld, because the
 * template's current gate only withholds the known sensitive classifications
 * from the 0.3 label-only contract.
 */
import {
  DEFAULT_ACCESS_EXCLUSION,
  coerceAccessLabel,
  isExcludedByDefault,
  normalizeAccessLabel,
  resolveAccessExclusion,
  type KBAccessLabel,
  type KBNode,
} from '../types';

export {
  DEFAULT_ACCESS_EXCLUSION,
  resolveAccessExclusion,
  coerceAccessLabel,
  normalizeAccessLabel,
  isExcludedByDefault,
} from '../types';

const TEMPLATE_SENSITIVE_CLASSIFICATIONS = new Set(['restricted', 'confidential', 'unknown']);
const TEMPLATE_SENSITIVE_VISIBILITIES = new Set(['private']);
const TEMPLATE_KNOWN_CLASSIFICATIONS = new Set(['public', 'internal', 'confidential', 'restricted', 'unknown']);
const TEMPLATE_CORE_EXCLUSION = resolveAccessExclusion(DEFAULT_ACCESS_EXCLUSION);

function normalizeAccessValue(value: unknown): KBAccessLabel | undefined {
  return normalizeAccessLabel(value) ?? coerceAccessLabel(value);
}

function isTemplateCoreExcluded(label: KBAccessLabel | undefined): boolean {
  if (!label) return false;
  const classification = label.classification?.trim().toLowerCase();
  if (classification && !TEMPLATE_KNOWN_CLASSIFICATIONS.has(classification)) {
    return false;
  }
  return isExcludedByDefault(label, TEMPLATE_CORE_EXCLUSION);
}

/**
 * True when a node's access label marks it sensitive enough to withhold from
 * render + search. Absent label → `false` (public, unchanged).
 */
export function isAccessWithheld(node: Pick<KBNode, 'access'>): boolean {
  const access = node.access;
  if (!access) return false;
  const label = normalizeAccessValue(access);
  if (!label) return false;

  const classification = label.classification?.trim().toLowerCase();
  if (classification && TEMPLATE_SENSITIVE_CLASSIFICATIONS.has(classification)) {
    return true;
  }

  const visibility = label.visibility?.trim().toLowerCase();
  if (visibility && TEMPLATE_SENSITIVE_VISIBILITIES.has(visibility)) {
    return true;
  }

  return isTemplateCoreExcluded(label);
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const label = normalizeAccessLabel(value);
  if (!label) return undefined;

  const sanitized: KBAccessLabel = {};
  if (typeof label.classification === 'string' && label.classification.trim()) {
    sanitized.classification = label.classification.trim();
  }
  if (typeof label.visibility === 'string' && label.visibility.trim()) {
    sanitized.visibility = label.visibility.trim();
  }
  if (Array.isArray(label.labels)) {
    const labels = label.labels.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
    if (labels.length > 0) sanitized.labels = labels;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
