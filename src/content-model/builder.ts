/**
 * Content-model builder (F2 / T2.2 + T2.3 — issues #161, #162).
 *
 * A five-pass, schema-driven pipeline that turns a {@link ContentModelSource}
 * into JSON-LD graph nodes + typed relationship edges:
 *
 *   1. read schema            (delegated to the schema reader)
 *   2. walk entities + index  (org detection: flat = default org, nested = org subdir)
 *   3. emit JSON-LD nodes     (cluster = kind; `data` is the verbatim record so
 *                              the field → node mapping is reversible)
 *   4. resolve FK edges        (scalar / array / composite / alias flavors;
 *                              unresolved refs become stub nodes + diagnostics)
 *   5. derive + deprecate      (computed `shared-target` edges; deprecated rules
 *                              are resolved but tagged `deprecated`)
 *
 * Relationships are attached to the **source node's `connections`** (with a
 * `relation`) so the engine's `buildGraph` renders them — `buildGraph` builds
 * edges from `connections`, not from a provider's `edges`. The directed/typed
 * `edges` array is also returned for callers (and tests) that want the full
 * resolved edge set.
 *
 * The builder is a **safe no-op** when no content-model source is present: it
 * returns empty results so existing graphs are unchanged.
 */
import yaml from 'yaml';
import { marked } from 'marked';
import type { Connection, JsonLd, KBEdge, KBNode } from '../../types';
import { buildJsonLd } from '../../types';
import type {
  ContentModelSchema,
  ContentModelSource,
  Diagnostic,
  EdgeRule,
  VocabularyOverlay,
} from './types';
import {
  SCHEMA_PATHS,
  buildUrn,
  canonicalKind,
  getConvention,
  hasContentModelSource,
  lifecycleBand,
  readContentModelSchema,
} from './schema-reader';

/** Provider id under which content-model nodes are emitted. */
export const CONTENT_MODEL_PROVIDER = 'content-model';

type EntityRecord = Record<string, unknown>;

/** Result of a content-model build. */
export interface ContentModelGraph {
  nodes: KBNode[];
  edges: KBEdge[];
  diagnostics: Diagnostic[];
}

/** A discovered entity: its kind (`@type`), id, org, canonical URN + raw record. */
interface EntityEntry {
  kind: string;
  id: string;
  org?: string;
  urn: string;
  record: EntityRecord;
  /**
   * The repo's native term when it differs from {@link EntityEntry.kind} — i.e.
   * a cross-repo alias (`cell`) was canonicalized to a kind (`squad`). Preserved
   * for display so a repo never loses the word it actually used. Undefined when
   * the declared `@type` is already canonical.
   */
  nativeType?: string;
  /** Companion markdown body (e.g. a sibling `.md`), when the kind declares one. */
  body?: string;
}

const NUL = '\u0000';
const key = (kind: string, value: string): string => `${kind}${NUL}${value}`;

function humanize(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Schema/index files that are never treated as entities. */
function isSchemaPath(path: string): boolean {
  if (path === SCHEMA_PATHS.teamops) return true;
  const top = path.split('/')[0];
  return top === 'schema' || top === 'index';
}

const YAML_RE = /\.ya?ml$/i;

function parseYaml(raw: string): EntityRecord | null {
  try {
    const doc = yaml.parse(raw);
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as EntityRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Detect an org-scoped entity's org from where it is stored relative to its
 * kind's path root: files at the root are the **default (home) org**; files in
 * a per-org subdirectory carry that subdir as the org.
 */
function detectOrg(
  schema: ContentModelSchema,
  kind: string,
  path: string,
  pathRoot: string,
): string | undefined {
  if (!schema.conventions.kinds[kind]?.orgScoped) return undefined;
  const prefix = `${pathRoot}/`;
  const rel = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const segments = rel.split('/');
  return segments.length > 1 ? segments[0] : schema.teamops.defaultOrg;
}

/** Look up a companion file (e.g. sibling `.md`) for an entity file. */
function companionBody(
  files: Record<string, string>,
  entityPath: string,
  ext: string | undefined,
): string | undefined {
  if (!ext) return undefined;
  const companion = entityPath.replace(YAML_RE, ext);
  return companion !== entityPath ? files[companion] : undefined;
}

// ── Pass 2: walk + index ───────────────────────────────────

interface Indexed {
  entries: EntityEntry[];
  byKindId: Map<string, EntityEntry>;
  byKindAlias: Map<string, EntityEntry>;
}

function walkEntities(schema: ContentModelSchema, source: ContentModelSource, diagnostics: Diagnostic[]): Indexed {
  const { typeField, idField } = schema.conventions;
  const entries: EntityEntry[] = [];
  const byKindId = new Map<string, EntityEntry>();
  const byKindAlias = new Map<string, EntityEntry>();

  for (const [path, raw] of Object.entries(source.files)) {
    if (isSchemaPath(path) || !YAML_RE.test(path)) continue;
    const record = parseYaml(raw);
    if (!record) {
      diagnostics.push({ level: 'warn', code: 'unparsable-entity', message: `Could not parse entity file`, ref: path });
      continue;
    }
    const declaredType = record[typeField] != null ? String(record[typeField]) : '';
    if (!declaredType) {
      diagnostics.push({ level: 'warn', code: 'missing-type', message: `Entity has no ${typeField}`, ref: path });
      continue;
    }
    // Cross-repo synonym layer (#153): canonicalize a per-repo alias term
    // (e.g. `cell`) to the kind it stands in for (e.g. `squad`) so it gets the
    // canonical kind + viewer. A no-op when no vocabulary is declared.
    const kind = canonicalKind(schema, declaredType);
    const nativeType = kind !== declaredType ? declaredType : undefined;
    const convention = getConvention(schema, kind);
    if (!convention) {
      diagnostics.push({ level: 'warn', code: 'unknown-kind', message: `No convention for kind "${kind}"`, ref: path });
      continue;
    }
    const id = record[idField] != null ? String(record[idField]) : '';
    if (!id) {
      diagnostics.push({ level: 'warn', code: 'missing-id', message: `Entity has no ${idField}`, ref: path });
      continue;
    }
    const org = detectOrg(schema, kind, path, convention.path);
    const urn = buildUrn(schema, kind, id, org, diagnostics);
    if (!urn) continue;

    const entry: EntityEntry = {
      kind,
      id,
      org,
      urn,
      record,
      nativeType,
      body: companionBody(source.files, path, convention.companionExt),
    };
    entries.push(entry);
    byKindId.set(key(kind, id), entry);
    if (convention.aliasField) {
      const alias = record[convention.aliasField];
      if (alias != null) byKindAlias.set(key(kind, String(alias)), entry);
    }
  }

  entries.sort((a, b) => (a.urn < b.urn ? -1 : a.urn > b.urn ? 1 : 0));
  return { entries, byKindId, byKindAlias };
}

// ── Pass 3: emit JSON-LD nodes ─────────────────────────────

function ldContextOf(schema: ContentModelSchema): JsonLd['@context'] {
  const ctx: Record<string, unknown> = { ...schema.context.prefixes };
  if (schema.context.base) ctx['@base'] = schema.context.base;
  return Object.keys(ctx).length > 0 ? ctx : 'https://schema.org';
}

function emitNode(schema: ContentModelSchema, entry: EntityEntry, ldContext: JsonLd['@context']): KBNode {
  const { kind, id, urn, record, body, nativeType } = entry;
  const title = String(record.name ?? record.title ?? id);
  // `data` is the verbatim record — the field → node mapping is reversible, and
  // because `@type` is copied verbatim the repo's native term survives in `data`.
  const data: EntityRecord = { ...record };
  const band = lifecycleBand(schema, kind);
  // Surface the lifecycle band (and the native vocabulary term, when this node
  // was canonicalized from a cross-repo alias) in the LD envelope without
  // polluting `data`. `nativeType` is only added for aliased nodes, so non-alias
  // output stays byte-identical.
  const ldData: EntityRecord = { ...data };
  if (band) ldData.lifecycle = band;
  if (nativeType) ldData.nativeType = nativeType;
  const content = body ? (marked.parse(body, { async: false }) as string) : '';
  return {
    id: urn,
    title,
    cluster: kind,
    content,
    rawContent: body ?? '',
    display: 'entity',
    connections: [],
    identity: urn,
    derived: true,
    source: { type: 'structured', entityType: kind, ref: id },
    entityType: kind,
    provider: CONTENT_MODEL_PROVIDER,
    data,
    jsonld: buildJsonLd({ id: urn, identity: urn }, kind, ldData, ldContext),
  };
}

// ── Passes 4 + 5: edge resolution ──────────────────────────

class EdgeResolver {
  readonly edges: KBEdge[] = [];
  private edgeKeys = new Set<string>();
  private connKeys = new Set<string>();
  readonly stubs = new Map<string, KBNode>();
  private readonly schema: ContentModelSchema;
  private readonly index: Indexed;
  private readonly nodeByUrn: Map<string, KBNode>;
  private readonly ldContext: JsonLd['@context'];
  private readonly diagnostics: Diagnostic[];

  constructor(
    schema: ContentModelSchema,
    index: Indexed,
    nodeByUrn: Map<string, KBNode>,
    ldContext: JsonLd['@context'],
    diagnostics: Diagnostic[],
  ) {
    this.schema = schema;
    this.index = index;
    this.nodeByUrn = nodeByUrn;
    this.ldContext = ldContext;
    this.diagnostics = diagnostics;
  }

  /** Resolve a reference to a target URN, lazily creating a stub when missing. */
  private resolve(targetKind: string, ref: string, mode: 'id' | 'alias'): string {
    const map = mode === 'alias' ? this.index.byKindAlias : this.index.byKindId;
    const hit = map.get(key(targetKind, ref));
    if (hit) return hit.urn;
    return this.stub(targetKind, ref);
  }

  /** Lookup-only resolution (no stub creation) — used for derived grouping. */
  private lookup(targetKind: string, ref: string, mode: 'id' | 'alias'): string | undefined {
    const map = mode === 'alias' ? this.index.byKindAlias : this.index.byKindId;
    return map.get(key(targetKind, ref))?.urn;
  }

  private stub(targetKind: string, ref: string): string {
    const urn = buildUrn(this.schema, targetKind, ref) ?? `kg://unresolved/${targetKind}/${ref}`;
    if (!this.stubs.has(urn)) {
      const data = { id: ref, unresolved: true };
      const node: KBNode = {
        id: urn,
        title: ref,
        cluster: targetKind,
        content: '',
        rawContent: '',
        display: 'entity',
        connections: [],
        identity: urn,
        derived: true,
        source: { type: 'structured', entityType: targetKind, ref },
        entityType: targetKind,
        provider: CONTENT_MODEL_PROVIDER,
        data,
        jsonld: buildJsonLd({ id: urn, identity: urn }, targetKind, data, this.ldContext),
      };
      this.stubs.set(urn, node);
      this.nodeByUrn.set(urn, node);
      this.diagnostics.push({
        level: 'warn',
        code: 'unresolved-ref',
        message: `Unresolved ${targetKind} reference "${ref}"`,
        ref: urn,
      });
    }
    return urn;
  }

  private addEdge(from: string, to: string, relation: string, description: string): void {
    if (from === to) return;
    const k = `${from}${NUL}${to}${NUL}${relation}`;
    if (!this.edgeKeys.has(k)) {
      this.edgeKeys.add(k);
      this.edges.push({ from, to, type: 'related', relation, description, source: 'inferred', weight: 1 });
    }
    // Attach a connection to the source node so buildGraph renders the edge.
    const ck = `${from}${NUL}${to}${NUL}${relation}`;
    if (!this.connKeys.has(ck)) {
      this.connKeys.add(ck);
      const conn: Connection = { to, type: 'related', description, source: 'inferred', relation };
      this.nodeByUrn.get(from)?.connections.push(conn);
    }
  }

  /** Apply a single FK rule to one source entry. */
  private applyRule(entry: EntityEntry, rule: EdgeRule, relationOverride?: string): void {
    const raw = entry.record[rule.field];
    if (raw == null) return;

    if (rule.fk === 'composite') {
      const parts = String(raw).split(':').map(p => p.trim());
      const legs = rule.composite ?? [];
      parts.forEach((part, i) => {
        const leg = legs[i];
        if (!leg) {
          this.diagnostics.push({
            level: 'warn',
            code: 'composite-arity',
            message: `Composite FK "${rule.id}" has no leg for part ${i} ("${part}")`,
            ref: entry.urn,
          });
          return;
        }
        const to = this.resolve(leg.to, part, 'id');
        this.addEdge(entry.urn, to, leg.relation, rule.description ?? humanize(leg.relation));
      });
      return;
    }

    const relation = relationOverride ?? rule.relation;
    const mode: 'id' | 'alias' = rule.fk === 'alias' ? 'alias' : 'id';
    const values = rule.fk === 'array'
      ? (Array.isArray(raw) ? raw : [raw])
      : [raw];
    for (const v of values) {
      if (v == null) continue;
      const to = this.resolve(rule.to ?? '', String(v).trim(), mode);
      this.addEdge(entry.urn, to, relation, rule.description ?? humanize(relation));
    }
  }

  /** Pass 4: resolve all FK rules (and deprecated rules, tagged `deprecated`). */
  resolveForeignKeys(): void {
    const byKind = new Map<string, EntityEntry[]>();
    for (const e of this.index.entries) {
      (byKind.get(e.kind) ?? byKind.set(e.kind, []).get(e.kind)!).push(e);
    }
    const run = (rules: EdgeRule[], deprecated: boolean) => {
      for (const rule of rules) {
        for (const entry of byKind.get(rule.from) ?? []) {
          this.applyRule(entry, rule, deprecated ? 'deprecated' : undefined);
        }
      }
    };
    run(this.schema.edges.edges, false);
    run(this.schema.edges.deprecated, true);
  }

  /** Pass 5: compute derived `shared-target` edges (deduped, undirected). */
  resolveDerived(): void {
    for (const rule of this.schema.edges.derived) {
      if (rule.type !== 'shared-target') continue;
      const via = this.schema.edges.edges.find(e => e.id === rule.via);
      if (!via || via.fk === 'composite' || !via.to) {
        this.diagnostics.push({
          level: 'warn',
          code: 'bad-derived',
          message: `Derived rule "${rule.id}" references unusable FK "${rule.via}"`,
        });
        continue;
      }
      const mode: 'id' | 'alias' = via.fk === 'alias' ? 'alias' : 'id';
      // group: target URN → source URNs that point at it
      const groups = new Map<string, string[]>();
      for (const entry of this.index.entries) {
        if (entry.kind !== via.from) continue;
        const raw = entry.record[via.field];
        if (raw == null) continue;
        const refs = via.fk === 'array' ? (Array.isArray(raw) ? raw : [raw]) : [raw];
        for (const r of refs) {
          const targetUrn = this.lookup(via.to, String(r).trim(), mode);
          if (!targetUrn) continue;
          (groups.get(targetUrn) ?? groups.set(targetUrn, []).get(targetUrn)!).push(entry.urn);
        }
      }
      for (const members of groups.values()) {
        const unique = [...new Set(members)].sort();
        for (let i = 0; i < unique.length; i++) {
          for (let j = i + 1; j < unique.length; j++) {
            this.addEdge(unique[i], unique[j], rule.relation, rule.description ?? humanize(rule.relation));
          }
        }
      }
    }
  }
}

// ── Orchestration ──────────────────────────────────────────

/**
 * Build the content-model graph from a source. Returns empty results (a safe
 * no-op) when no content-model source is present.
 *
 * An optional cross-repo {@link VocabularyOverlay} (#153) — a shared synonym
 * layer supplied independently of any single repo's context — is merged on top
 * of the source's own `index/vocabulary.jsonld` so repos using different words
 * for the same concept unify to one canonical kind.
 */
export function buildContentModel(
  source: ContentModelSource | null | undefined,
  vocabularyOverlay?: VocabularyOverlay,
): ContentModelGraph {
  if (!hasContentModelSource(source)) {
    return { nodes: [], edges: [], diagnostics: [] };
  }
  const src = source as ContentModelSource;
  const { schema, diagnostics } = readContentModelSchema(src, vocabularyOverlay);
  const ldContext = ldContextOf(schema);

  // Pass 2: walk + index
  const index = walkEntities(schema, src, diagnostics);

  // Pass 3: emit nodes
  const nodeByUrn = new Map<string, KBNode>();
  for (const entry of index.entries) {
    nodeByUrn.set(entry.urn, emitNode(schema, entry, ldContext));
  }

  // Passes 4 + 5: edges
  const resolver = new EdgeResolver(schema, index, nodeByUrn, ldContext, diagnostics);
  resolver.resolveForeignKeys();
  resolver.resolveDerived();

  const nodes = [...nodeByUrn.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = resolver.edges.slice().sort((a, b) => {
    const ka = `${a.from}${NUL}${a.to}${NUL}${a.relation}`;
    const kb = `${b.from}${NUL}${b.to}${NUL}${b.relation}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return { nodes, edges, diagnostics };
}
