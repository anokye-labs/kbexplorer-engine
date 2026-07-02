/**
 * Schema reader (F2 / T2.1 — issue #160).
 *
 * Parses the five content-model schema files into a typed
 * {@link ContentModelSchema} and provides identity resolution:
 *
 * - `teamops.yaml`        → authority + default org
 * - `schema/conventions.yaml` → per-kind storage + mapping (path, org-scoping…)
 * - `schema/edges.yaml`   → FK / derived / deprecated edge rules
 * - `schema/lifecycle.yaml`   → kind → lifecycle band
 * - `index/context.jsonld`    → CURIE prefix → URN base
 * - `index/vocabulary.jsonld` → optional cross-repo alias term → canonical kind (#153)
 *
 * URN bases come from the JSON-LD context **only** (never hardcoded), and a
 * node's kind always comes from its `@type` (never the file path). When a
 * cross-repo vocabulary is declared, an alias `@type` is first canonicalized to
 * the kind it stands in for (e.g. `cell` → `squad`) before any resolution.
 */
import yaml from 'yaml';
import { stripScheme } from '@anokye-labs/kbexplorer-core';
import type {
  ContentModelSchema,
  ContentModelSource,
  Conventions,
  Diagnostic,
  EdgesSpec,
  JsonLdContext,
  KindConvention,
  Lifecycle,
  TeamOps,
  VocabularyOverlay,
} from './types';

/** Canonical schema-file locations relative to the content-model root. */
export const SCHEMA_PATHS = {
  teamops: 'teamops.yaml',
  conventions: 'schema/conventions.yaml',
  edges: 'schema/edges.yaml',
  lifecycle: 'schema/lifecycle.yaml',
  context: 'index/context.jsonld',
  /**
   * Optional cross-repo vocabulary / synonym overlay (#153): a JSON-LD
   * `@context` mapping per-repo alias terms → a canonical kind. Absent in most
   * repos, in which case the synonym layer is a safe no-op.
   */
  vocabulary: 'index/vocabulary.jsonld',
} as const;

/**
 * A content-model source is "present" iff the identity anchor (`teamops.yaml`)
 * and the URN context (`index/context.jsonld`) both exist. When absent the
 * provider must be a no-op so existing graphs are unchanged.
 */
export function hasContentModelSource(source: ContentModelSource | null | undefined): boolean {
  if (!source) return false;
  const f = source.files;
  return typeof f[SCHEMA_PATHS.teamops] === 'string' && typeof f[SCHEMA_PATHS.context] === 'string';
}

function parseYaml(raw: string | undefined): unknown {
  if (raw == null) return undefined;
  try {
    return yaml.parse(raw);
  } catch {
    return undefined;
  }
}

function parseTeamOps(raw: string | undefined, diags: Diagnostic[]): TeamOps {
  const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const identity = (doc.identity ?? doc) as Record<string, unknown>;
  const orgsRaw = (doc.orgs ?? identity.orgs ?? []) as Array<Record<string, unknown>>;
  const orgs = orgsRaw.map(o => ({
    id: String(o.id ?? ''),
    name: o.name != null ? String(o.name) : undefined,
    default: o.default === true,
  }));
  const authority = String(identity.authority ?? '');
  let defaultOrg = String(identity.defaultOrg ?? identity.org ?? orgs.find(o => o.default)?.id ?? '');
  if (!authority) diags.push({ level: 'error', code: 'missing-authority', message: 'teamops.yaml has no identity.authority' });
  if (!defaultOrg && orgs.length > 0) defaultOrg = orgs[0].id;
  return { authority, defaultOrg, orgs };
}

function parseConventions(raw: string | undefined, diags: Diagnostic[]): Conventions {
  const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const kindsRaw = (doc.kinds ?? {}) as Record<string, Record<string, unknown>>;
  const kinds: Record<string, KindConvention> = {};
  for (const [kind, c] of Object.entries(kindsRaw)) {
    if (!c || typeof c !== 'object') continue;
    kinds[kind] = {
      kind,
      path: String(c.path ?? kind),
      orgScoped: c.orgScoped === true,
      aliasField: c.aliasField != null ? String(c.aliasField) : undefined,
      passthrough: Array.isArray(c.passthrough) ? c.passthrough.map(String) : undefined,
      companionExt: c.companionExt != null ? String(c.companionExt) : undefined,
    };
  }
  if (Object.keys(kinds).length === 0) {
    diags.push({ level: 'warn', code: 'no-kinds', message: 'conventions.yaml declares no kinds' });
  }
  return {
    typeField: String(doc.typeField ?? '@type'),
    idField: String(doc.idField ?? 'id'),
    kinds,
  };
}

function parseEdges(raw: string | undefined): EdgesSpec {
  const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const edges = Array.isArray(doc.edges) ? (doc.edges as EdgesSpec['edges']) : [];
  const derived = Array.isArray(doc.derived) ? (doc.derived as EdgesSpec['derived']) : [];
  const deprecated = Array.isArray(doc.deprecated) ? (doc.deprecated as EdgesSpec['deprecated']) : [];
  // Deprecated rules are always tagged with the `deprecated` relation regardless
  // of how they were authored, so styling stays consistent.
  for (const d of deprecated) d.relation = 'deprecated';
  return { edges, derived, deprecated };
}

function parseLifecycle(raw: string | undefined): Lifecycle {
  const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const bandsRaw = (doc.bands ?? {}) as Record<string, unknown>;
  const bands: Record<string, string[]> = {};
  for (const [band, kinds] of Object.entries(bandsRaw)) {
    bands[band] = Array.isArray(kinds) ? kinds.map(String) : [];
  }
  return { bands };
}

/** Normalize a URN base so it always ends in a single `/`. */
function normalizeBase(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}

function parseContext(raw: string | undefined, diags: Diagnostic[]): JsonLdContext {
  let doc: Record<string, unknown> = {};
  if (raw != null) {
    try {
      doc = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      diags.push({ level: 'error', code: 'bad-context', message: 'index/context.jsonld is not valid JSON' });
    }
  }
  const ctx = (doc['@context'] ?? doc) as Record<string, unknown>;
  const prefixes: Record<string, string> = {};
  let base: string | undefined;
  for (const [key, value] of Object.entries(ctx)) {
    if (key === '@base') {
      base = normalizeBase(String(value));
      continue;
    }
    if (key.startsWith('@')) continue; // other JSON-LD keywords (@vocab, @version…)
    // A term maps to a URN base, either as a bare string or `{ "@id": "…" }`.
    const iri = typeof value === 'string'
      ? value
      : (value && typeof value === 'object' ? String((value as Record<string, unknown>)['@id'] ?? '') : '');
    if (iri) prefixes[key] = normalizeBase(iri);
  }
  if (Object.keys(prefixes).length === 0) {
    diags.push({ level: 'error', code: 'no-prefixes', message: 'context.jsonld declares no CURIE prefixes' });
  }
  return { base, prefixes };
}

// ── Cross-repo vocabulary / synonym layer (#153) ───────────

/**
 * Extract alias → canonical mappings from a JSON-LD-shaped document whose
 * `@context` aliases per-repo terms to a canonical kind. Each entry's value is
 * either a bare canonical term (`"cell": "squad"`) or a `{ "@id": "squad" }`
 * object — mirroring how {@link parseContext} reads prefix definitions, so the
 * synonym layer is authored exactly like the rest of the JSON-LD context.
 *
 * JSON-LD keywords (`@base`, `@vocab`, `@version`, …) and self-mappings
 * (`alias === canonical`, a no-op) are ignored. An array-valued `@context`
 * (a legal JSON-LD shape) carries no inline term→canonical aliases, so it is
 * ignored rather than iterated by numeric index (which would yield bogus maps).
 */
function aliasesFromContext(doc: Record<string, unknown>): Record<string, string> {
  const ctx = (doc['@context'] ?? doc) as Record<string, unknown>;
  const aliases: Record<string, string> = {};
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return aliases;
  for (const [term, value] of Object.entries(ctx)) {
    if (term.startsWith('@')) continue; // JSON-LD keywords
    const canonical = typeof value === 'string'
      ? value
      : (value && typeof value === 'object' ? String((value as Record<string, unknown>)['@id'] ?? '') : '');
    const a = term.trim();
    const c = canonical.trim();
    if (!a || !c || a === c) continue; // ignore empty / self-mapping (safe no-op)
    aliases[a] = c;
  }
  return aliases;
}

/**
 * Parse a raw `vocabulary.jsonld` document into alias → canonical mappings.
 *
 * `sourceLabel` names the document in diagnostics so an invalid **overlay**
 * (supplied independently of any repo file) is not misattributed to the repo's
 * `index/vocabulary.jsonld` path.
 */
function parseVocabularyDoc(
  raw: string | undefined,
  diags: Diagnostic[],
  sourceLabel: string = SCHEMA_PATHS.vocabulary,
): Record<string, string> {
  if (raw == null) return {};
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    diags.push({ level: 'error', code: 'bad-vocabulary', message: `${sourceLabel} is not valid JSON` });
    return {};
  }
  return aliasesFromContext(doc);
}

/** Normalize an overlay (raw JSON-LD string or parsed {@link Vocabulary}) to aliases. */
function overlayAliases(overlay: VocabularyOverlay, diags: Diagnostic[]): Record<string, string> {
  if (overlay == null) return {};
  if (typeof overlay === 'string') return parseVocabularyDoc(overlay, diags, 'vocabulary overlay');
  return { ...overlay.aliases };
}

/**
 * Resolve an entity's declared term (`@type`) to its canonical kind via the
 * cross-repo vocabulary. Returns the term unchanged when no alias is declared,
 * so the layer is a **safe no-op** (output byte-identical to a build without it).
 *
 * Resolution is a single hop: a canonical target is expected to itself be a
 * declared kind/CURIE prefix (not another alias).
 */
export function canonicalKind(schema: ContentModelSchema, term: string): string {
  return schema.vocabulary.aliases[term] ?? term;
}

/**
 * Read and parse all schema files from a content-model source.
 * Always returns a schema (best-effort) plus any diagnostics encountered.
 *
 * An optional cross-repo {@link VocabularyOverlay} (#153) is merged on top of
 * the repo's own `index/vocabulary.jsonld`. The overlay is the **shared layer
 * supplied independently of any single repo's context**; when its terms collide
 * with the repo-local file the overlay wins. With neither present the vocabulary
 * is empty and the synonym layer is a safe no-op.
 */
export function readContentModelSchema(
  source: ContentModelSource,
  overlay?: VocabularyOverlay,
): { schema: ContentModelSchema; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const f = source.files;
  const aliases: Record<string, string> = {
    ...parseVocabularyDoc(f[SCHEMA_PATHS.vocabulary], diagnostics),
    ...overlayAliases(overlay, diagnostics),
  };
  const schema: ContentModelSchema = {
    teamops: parseTeamOps(f[SCHEMA_PATHS.teamops], diagnostics),
    conventions: parseConventions(f[SCHEMA_PATHS.conventions], diagnostics),
    edges: parseEdges(f[SCHEMA_PATHS.edges]),
    lifecycle: parseLifecycle(f[SCHEMA_PATHS.lifecycle]),
    context: parseContext(f[SCHEMA_PATHS.context], diagnostics),
    vocabulary: { aliases },
  };
  return { schema, diagnostics };
}

// ── Identity resolution ────────────────────────────────────

/** Whether a kind is org-scoped (carries an `/{org}` URN segment). */
export function isOrgScoped(schema: ContentModelSchema, kind: string): boolean {
  return schema.conventions.kinds[kind]?.orgScoped === true;
}

/**
 * Derive the local/display node id for a canonical content-model URN.
 *
 * Content-model nodes carry TWO distinct identifiers (#445 / AF-003):
 *  - `identity` — the canonical URN minted by {@link buildUrn} from the JSON-LD
 *    context (e.g. `kg://xbox.com/people/ada`), the cross-provider merge key;
 *  - `id` — this provider-local display key, derived deterministically from the
 *    URN by stripping its `<scheme>://` prefix (e.g. `xbox.com/people/ada`).
 *
 * The mapping is a pure 1:1 function of the URN, so any consumer (viewers,
 * link resolution) can recover a node's graph id from a resolved URN without
 * access to the node set. Delegates to core's `stripScheme` (idempotent when
 * no scheme is present).
 */
export function urnLocalId(urn: string): string {
  return stripScheme(urn);
}

/**
 * Build a canonical URN for an entity.
 *
 * The URN **base** is read from the JSON-LD context (never hardcoded). For
 * org-scoped kinds the org segment is spliced in after the base, defaulting to
 * the home org from `teamops.yaml`:
 *
 *   org-scoped:        `{base}{org}/{id}`   → `kg://xbox.com/squads/personalization/game-assist`
 *   authority-scoped:  `{base}{id}`         → `kg://xbox.com/people/ada`
 *
 * Returns `null` (and pushes a diagnostic) when the kind has no context prefix.
 */
export function buildUrn(
  schema: ContentModelSchema,
  kind: string,
  id: string,
  org?: string,
  diagnostics?: Diagnostic[],
): string | null {
  const base = schema.context.prefixes[kind];
  if (!base) {
    diagnostics?.push({ level: 'error', code: 'unknown-prefix', message: `No URN base in context for kind "${kind}"`, ref: `${kind}:${id}` });
    return null;
  }
  if (isOrgScoped(schema, kind)) {
    const resolvedOrg = org ?? schema.teamops.defaultOrg;
    return `${base}${resolvedOrg}/${id}`;
  }
  return `${base}${id}`;
}

/**
 * Resolve a CURIE (`prefix:local`) to a URN. Already-expanded URNs (containing
 * `://`) are returned unchanged. Org-scoped prefixes use the optional `org`
 * (defaulting to the home org).
 *
 * @example resolveCurie(schema, 'squad:game-assist') // kg://xbox.com/squads/personalization/game-assist
 */
export function resolveCurie(
  schema: ContentModelSchema,
  curie: string,
  opts: { org?: string; diagnostics?: Diagnostic[] } = {},
): string | null {
  const value = curie.trim();
  const idx = value.indexOf(':');
  if (idx < 0) {
    opts.diagnostics?.push({ level: 'warn', code: 'not-a-curie', message: `"${curie}" is not a CURIE`, ref: curie });
    return null;
  }
  const local = value.slice(idx + 1);
  // Already a full URI (scheme://…) — return verbatim.
  if (local.startsWith('//')) return value;
  const prefix = value.slice(0, idx);
  if (!schema.context.prefixes[prefix]) {
    opts.diagnostics?.push({ level: 'warn', code: 'unknown-prefix', message: `Unknown CURIE prefix "${prefix}"`, ref: curie });
    return null;
  }
  return buildUrn(schema, prefix, local, opts.org, opts.diagnostics);
}

/** Look up the lifecycle band a kind belongs to (e.g. `mission` → `per-cycle`). */
export function lifecycleBand(schema: ContentModelSchema, kind: string): string | undefined {
  for (const [band, kinds] of Object.entries(schema.lifecycle.bands)) {
    if (kinds.includes(kind)) return band;
  }
  return undefined;
}

/** Get the storage convention for a kind. */
export function getConvention(schema: ContentModelSchema, kind: string): KindConvention | undefined {
  return schema.conventions.kinds[kind];
}
