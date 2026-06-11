/**
 * Content-model ingestion types (F2 — issue #149).
 *
 * The content model is **schema-driven**: identity/authority comes from
 * `teamops.yaml`, storage layout from `schema/conventions.yaml`, relationships
 * from `schema/edges.yaml`, lifecycle bands from `schema/lifecycle.yaml`, and
 * URN bases from `index/context.jsonld`. The engine reads these files rather
 * than hardcoding any org's structure, so a second org adopts the platform by
 * changing config — not engine code.
 *
 * Hard rules encoded here:
 * - A node's **kind comes from its `@type`**, never from the file path.
 * - **URN bases come from the JSON-LD context only** — never hardcoded.
 */

/** Lifecycle band from `schema/lifecycle.yaml` (open — custom bands allowed). */
export type LifecycleBand = 'durable' | 'per-cycle' | 'per-event' | (string & {});

/** Foreign-key resolution flavor from `schema/edges.yaml`. */
export type FkFlavor = 'scalar' | 'array' | 'composite' | 'alias';

/** One org declared in `teamops.yaml`. */
export interface OrgDef {
  id: string;
  name?: string;
  /** Whether this is the home/default org (its entities are stored flat). */
  default?: boolean;
}

/** `teamops.yaml` — maps identity to an authority + a default (home) org. */
export interface TeamOps {
  /** Authority host, e.g. `xbox.com` — the URN authority segment. */
  authority: string;
  /** Default/home org id; entities of org-scoped kinds default to it when flat. */
  defaultOrg: string;
  /** All known orgs. */
  orgs: OrgDef[];
}

/** Storage + mapping convention for a single kind (from `schema/conventions.yaml`). */
export interface KindConvention {
  /** Kind id (matches the entity's `@type`). */
  kind: string;
  /** Storage root relative to the content-model root (e.g. `squads`). */
  path: string;
  /**
   * Whether this kind is org-scoped. Org-scoped kinds carry an `/{org}` segment
   * in their URN and store the **default org flat** / **non-default orgs nested**
   * in a per-org subdirectory. Authority-scoped kinds omit the org segment.
   */
  orgScoped: boolean;
  /** Field carrying this kind's alias handle (the target of an `alias` FK). */
  aliasField?: string;
  /**
   * Fields copied verbatim into `data`. When omitted, **all** fields pass
   * through (the default), which keeps the field→data mapping reversible.
   */
  passthrough?: string[];
  /** Sibling-file extension whose content is merged as the node body (e.g. `.md`). */
  companionExt?: string;
}

/** `schema/conventions.yaml` — per-kind storage + mapping. */
export interface Conventions {
  /** Field carrying the kind discriminator. Default `@type`; never path-derived. */
  typeField: string;
  /** Field carrying the entity id. Default `id`. */
  idField: string;
  /** kind → convention. */
  kinds: Record<string, KindConvention>;
}

/** One leg of a composite FK (`<a>:<b>` → two edges). */
export interface CompositeLeg {
  /** Target kind for this leg. */
  to: string;
  /** Relation taxonomy label for this leg. */
  relation: string;
}

/** A foreign-key edge rule from `schema/edges.yaml`. */
export interface EdgeRule {
  id: string;
  /** Source kind. */
  from: string;
  /** Field on the source entity carrying the foreign key. */
  field: string;
  /** Target kind (omitted for `composite`, which uses `composite[]`). */
  to?: string;
  fk: FkFlavor;
  /** Relation taxonomy label applied to resolved edges. */
  relation: string;
  /** Legs for a `composite` FK, in the order the `<a>:<b>` parts appear. */
  composite?: CompositeLeg[];
  description?: string;
}

/**
 * A derived edge rule — computed from existing edges, not stored on entities.
 * `shared-target`: sources that point at the **same** target of the referenced
 * FK rule (`via`) are linked to each other. Deduped so a pair is stored once.
 */
export interface DerivedRule {
  id: string;
  type: 'shared-target';
  /** Id of the {@link EdgeRule} whose targets define the grouping. */
  via: string;
  relation: string;
  description?: string;
}

/** `schema/edges.yaml` — FK edges + derived + deprecated. */
export interface EdgesSpec {
  edges: EdgeRule[];
  derived: DerivedRule[];
  /** Edge rules whose resolved edges are tagged `deprecated`. */
  deprecated: EdgeRule[];
}

/** `schema/lifecycle.yaml` — band → kinds. */
export interface Lifecycle {
  bands: Record<string, string[]>;
}

/** Parsed `index/context.jsonld` — CURIE prefix → URN base. */
export interface JsonLdContext {
  /** The `@base` keyword, when present. */
  base?: string;
  /** prefix → URN base (full, e.g. `kg://xbox.com/squads/`). */
  prefixes: Record<string, string>;
}

/** The fully-parsed content-model schema. */
export interface ContentModelSchema {
  teamops: TeamOps;
  conventions: Conventions;
  edges: EdgesSpec;
  lifecycle: Lifecycle;
  context: JsonLdContext;
}

/** Severity of a build/schema diagnostic. */
export type DiagnosticLevel = 'info' | 'warn' | 'error';

/** A diagnostic raised while reading the schema or building the graph. */
export interface Diagnostic {
  level: DiagnosticLevel;
  /** Stable machine code, e.g. `unresolved-ref`, `unknown-prefix`. */
  code: string;
  message: string;
  /** Related id / path / URN for context. */
  ref?: string;
}

/**
 * A flat content-model source: schema files + entity files keyed by path
 * relative to {@link ContentModelSource.root}. This abstraction lets the same
 * builder run against build-time fixtures, the local manifest, and live fetch.
 */
export interface ContentModelSource {
  /** Root dir name within the repo (e.g. `content-model`). */
  root: string;
  /** path (relative to `root`) → raw file content. */
  files: Record<string, string>;
}
