/**
 * structured-node-map.ts — declarative + heuristic mapping of STRUCTURED files
 * into typed JSON-LD knowledge-graph nodes (Feature F3 / #166).
 *
 * This is the "agile discovery" seam: as new structured kinds keep appearing
 * during a migration, a `structured-node-map.yaml` absorbs them by
 * *configuration* (glob / shape → `@type` → field & edge mapping) instead of
 * code edits. When no rule matches, a heuristic shape-inference fallback
 * still produces a sensible typed node so coverage is never zero.
 *
 * The module is **pure** (no I/O, no React): callers pass a `{ path, content }`
 * pair and receive a {@link KBNode} (or `null` for non-structured input). Every
 * produced node is built through the F1 contract — `source:'structured'` +
 * `entityType` + `buildJsonLd()` — and is *reversible*: the full parsed object
 * is preserved on `node.data`, so {@link reconstructSource} can re-serialise the
 * original file from the node alone.
 *
 * It is deliberately distinct from `nodemap.ts` (no "structured" prefix, note
 * the naming), which maps repo files/dirs/globs into the file & content
 * layers. This module owns the open node-type / JSON-LD path for structured
 * config files. The names look similar on purpose — they solve neighbouring
 * problems — so if you're hunting for one, check both.
 */
import yaml from 'yaml';
import type { KBNode, NodeSource } from '@anokye-labs/kbexplorer-core';
import { buildJsonLd } from '@anokye-labs/kbexplorer-core';
import { urnIdentity } from './identity';

// ── Public types ───────────────────────────────────────────

export type StructuredFormat = 'json' | 'yaml';

/** A structured file handed to the mapper. */
export interface StructuredFile {
  path: string;
  content: string;
}

/** An edge the produced node should carry (mapped onto a `Connection`). */
export interface NodeMapEdgeRule {
  /** Target node id. */
  to: string;
  /** Taxonomy relation (e.g. `structural`). */
  relation?: string;
  /** Structural edge type (defaults to `references` downstream). */
  type?: string;
  description?: string;
}

/** A single declarative mapping rule. */
export interface NodeMapRule {
  /** Informational rule id. */
  id?: string;
  /** Glob(s) the file path must match (any-of). Omit to match every path. */
  glob?: string | string[];
  /** Top-level keys the parsed object must all contain (shape match). */
  shape?: string[];
  /** JSON-LD `@type` assigned to matched files. */
  type: string;
  /** Registry `entityType`; defaults to a slug of `type`. */
  entityType?: string;
  cluster?: string;
  emoji?: string;
  /** Dot-path into the parsed data used as the node title. */
  titleFrom?: string;
  /**
   * Promote selected parsed values into the JSON-LD envelope:
   * `{ outputProp: 'dot.path.in.data' }`. The full parsed object is always
   * retained on `node.data` regardless, so mapping stays reversible.
   */
  fields?: Record<string, string>;
  /** Edges emitted from the produced node. */
  edges?: NodeMapEdgeRule[];
}

/** Parsed `structured-node-map.yaml`. */
export interface StructuredNodeMap {
  rules: NodeMapRule[];
}

/** Options controlling node identity/cluster when applying a map. */
export interface ApplyOptions {
  /** Explicit node id (overrides the path-derived default). */
  id?: string;
  /** Prefix for the path-derived id (default `cfg`). */
  idPrefix?: string;
  /** Fallback cluster when neither rule nor heuristic provides one. */
  cluster?: string;
}

// ── Glob helpers ───────────────────────────────────────────

/** Convert a simple glob pattern to a RegExp (mirrors nodemap.ts semantics). */
export function globToRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i += 1;
      if (pattern[i + 1] === '/') i += 1;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAnyGlob(path: string, globs: string | string[] | undefined): boolean {
  if (globs === undefined) return true; // a rule with no glob matches every path
  const list = Array.isArray(globs) ? globs : [globs];
  return list.some(g => globToRegex(g).test(path));
}

// ── Path / value helpers ───────────────────────────────────

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

function baseName(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(0, dot) : name;
}

function extOf(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.substring(dot + 1).toLowerCase() : '';
}

/** Deterministic, url-safe slug for ids. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Resolve a dot-path (e.g. `runs.using`) against a parsed object. */
function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── Parsing ────────────────────────────────────────────────

/**
 * Parse a structured file's content into `{ format, data }`. Returns `null`
 * when the content is not structured object/array data (e.g. plain prose,
 * binary, or an empty document) — such files are not this module's concern.
 */
export function parseStructuredContent(
  file: StructuredFile,
): { format: StructuredFormat; data: Record<string, unknown> | unknown[] } | null {
  const ext = extOf(file.path);
  const raw = file.content;
  if (!raw || !raw.trim()) return null;

  const tryParse = (format: StructuredFormat): { format: StructuredFormat; data: Record<string, unknown> | unknown[] } | null => {
    try {
      const parsed = format === 'json' ? JSON.parse(raw) : (yaml.parse(raw) as unknown);
      if (isPlainObject(parsed) || Array.isArray(parsed)) {
        return { format, data: parsed as Record<string, unknown> | unknown[] };
      }
    } catch {
      /* fall through */
    }
    return null;
  };

  if (ext === 'json' || ext === 'jsonld') return tryParse('json');
  if (ext === 'yml' || ext === 'yaml') return tryParse('yaml');
  // Unknown extension: YAML is a JSON superset, so a single attempt covers both.
  return tryParse('yaml');
}

// ── Rule matching ──────────────────────────────────────────

/** Find the first rule whose glob + shape both match the parsed file. */
export function matchRule(
  file: StructuredFile,
  data: Record<string, unknown> | unknown[],
  map: StructuredNodeMap,
): NodeMapRule | undefined {
  for (const rule of map.rules ?? []) {
    if (!matchesAnyGlob(file.path, rule.glob)) continue;
    if (rule.shape?.length) {
      if (!isPlainObject(data)) continue;
      const hasAll = rule.shape.every(k => k in data);
      if (!hasAll) continue;
    }
    return rule;
  }
  return undefined;
}

// ── Node building ──────────────────────────────────────────

function deriveId(file: StructuredFile, options?: ApplyOptions): string {
  if (options?.id) return options.id;
  const prefix = options?.idPrefix ?? 'cfg';
  // Slug the full path (not just the basename) so same-named files in different
  // directories (e.g. `a/config.yml` vs `b/config.yml`) don't collide.
  return `${prefix}-${slugify(file.path)}`;
}

function structuredSource(entityType: string, ref: string): NodeSource {
  return { type: 'structured', entityType, ref };
}

function makeNode(args: {
  id: string;
  title: string;
  cluster: string;
  emoji: string;
  entityType: string;
  ldType: string;
  data: Record<string, unknown> | unknown[];
  ref: string;
  ldProps?: Record<string, unknown>;
  edges?: NodeMapEdgeRule[];
}): KBNode {
  const identity = urnIdentity('structured', args.ref);
  const dataBag = isPlainObject(args.data)
    ? args.data
    : { items: args.data };
  return {
    id: args.id,
    title: args.title,
    cluster: args.cluster,
    content: '',
    rawContent: '',
    emoji: args.emoji,
    display: 'entity',
    connections: (args.edges ?? []).map(e => ({
      to: e.to,
      type: e.type,
      relation: e.relation,
      description: e.description ?? 'Structural',
      source: 'inferred' as const,
    })),
    identity,
    derived: true,
    source: structuredSource(args.entityType, args.ref),
    entityType: args.entityType,
    data: dataBag,
    jsonld: buildJsonLd({ id: args.id, identity }, args.ldType, args.ldProps ?? {}),
  };
}

function titleFromData(
  data: Record<string, unknown> | unknown[],
  rule: NodeMapRule | undefined,
  file: StructuredFile,
): string {
  if (rule?.titleFrom) {
    const v = getByPath(data, rule.titleFrom);
    if (typeof v === 'string' && v.trim()) return v;
  }
  if (isPlainObject(data)) {
    const name = data.name ?? data.title;
    if (typeof name === 'string' && name.trim()) return name;
  }
  return baseName(file.path);
}

/** Build a node from a matched declarative rule. */
function buildMappedNode(
  file: StructuredFile,
  data: Record<string, unknown> | unknown[],
  rule: NodeMapRule,
  options?: ApplyOptions,
): KBNode {
  const entityType = rule.entityType ?? slugify(rule.type);
  const ldProps: Record<string, unknown> = {};
  if (rule.fields) {
    for (const [out, src] of Object.entries(rule.fields)) {
      const v = getByPath(data, src);
      if (v !== undefined) ldProps[out] = v;
    }
  }
  return makeNode({
    id: deriveId(file, options),
    title: titleFromData(data, rule, file),
    cluster: rule.cluster ?? options?.cluster ?? 'infra',
    emoji: rule.emoji ?? 'DocumentData',
    entityType,
    ldType: rule.type,
    data,
    ref: file.path,
    ldProps,
    edges: rule.edges,
  });
}

/** Heuristic shape inference: pick a sensible `@type` from the parsed shape. */
function inferType(data: Record<string, unknown> | unknown[]): { ldType: string; entityType: string; emoji: string } {
  if (isPlainObject(data)) {
    const has = (k: string) => k in data;
    if (has('on') && has('jobs')) return { ldType: 'Workflow', entityType: 'workflow', emoji: 'Flow' };
    if (has('runs')) return { ldType: 'SoftwareApplication', entityType: 'github-action', emoji: 'PuzzlePiece' };
    if (has('version') && has('updates')) return { ldType: 'DependabotConfig', entityType: 'dependabot-config', emoji: 'ArrowSync' };
    if (has('inputs') || has('outputs')) return { ldType: 'ParameterisedConfig', entityType: 'structured-config', emoji: 'Options' };
  }
  return { ldType: 'StructuredConfig', entityType: 'structured-config', emoji: 'DocumentData' };
}

/**
 * Heuristic fallback for an UNMAPPED structured file: parse → infer a sensible
 * `@type` from its shape → produce a typed node whose `data` retains the full
 * parsed object (so it stays reversible). Returns `null` for non-structured
 * content.
 */
export function inferStructuredNode(
  file: StructuredFile,
  parsed?: { format: StructuredFormat; data: Record<string, unknown> | unknown[] } | null,
  options?: ApplyOptions,
): KBNode | null {
  const result = parsed ?? parseStructuredContent(file);
  if (!result) return null;
  const { ldType, entityType, emoji } = inferType(result.data);
  return makeNode({
    id: deriveId(file, options),
    title: titleFromData(result.data, undefined, file),
    cluster: options?.cluster ?? 'infra',
    emoji,
    entityType,
    ldType,
    data: result.data,
    ref: file.path,
  });
}

/**
 * Map a structured file to a typed node. A matching declarative rule wins;
 * otherwise the heuristic fallback runs. Returns `null` only when the file is
 * not structured object/array data.
 */
export function applyStructuredNodeMap(
  file: StructuredFile,
  map: StructuredNodeMap | null | undefined,
  options?: ApplyOptions,
): KBNode | null {
  const parsed = parseStructuredContent(file);
  if (!parsed) return null;

  const rule = map ? matchRule(file, parsed.data, map) : undefined;
  if (rule) return buildMappedNode(file, parsed.data, rule, options);
  return inferStructuredNode(file, parsed, options);
}

// ── structured-node-map.yaml parsing ───────────────────────

/** Parse a `structured-node-map.yaml` document into a normalised {@link StructuredNodeMap}. */
export function parseStructuredNodeMap(raw: string | null | undefined): StructuredNodeMap {
  if (!raw || !raw.trim()) return { rules: [] };
  try {
    const parsed = yaml.parse(raw) as { rules?: NodeMapRule[] } | null;
    const rules = Array.isArray(parsed?.rules) ? parsed!.rules.filter(r => r && typeof r.type === 'string') : [];
    return { rules };
  } catch {
    return { rules: [] };
  }
}

// ── Reversibility ──────────────────────────────────────────

/**
 * Re-serialise the original source content from a node produced by this module.
 * Reversibility is *semantic*: re-parsing the output yields the same object that
 * was stored on `node.data`. The format is inferred from the node's
 * `source.ref` extension unless overridden.
 */
export function reconstructSource(
  node: Pick<KBNode, 'data' | 'source'>,
  formatOverride?: StructuredFormat,
): string {
  const data = node.data ?? {};
  let format: StructuredFormat = formatOverride ?? 'yaml';
  if (!formatOverride && node.source.type === 'structured' && node.source.ref) {
    const ext = extOf(node.source.ref);
    if (ext === 'json' || ext === 'jsonld') format = 'json';
  }
  // Unwrap the array wrapper applied by makeNode for non-object data.
  const payload =
    isPlainObject(data) && Object.keys(data).length === 1 && Array.isArray((data as Record<string, unknown>).items)
      ? (data as Record<string, unknown>).items
      : data;
  return format === 'json' ? JSON.stringify(payload, null, 2) : yaml.stringify(payload);
}
