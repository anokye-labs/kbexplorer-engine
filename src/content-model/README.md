# Content-model ingestion pipeline (F2 — issue #149)

A schema-driven, 5-pass graph builder that turns a **content-model source** (a set
of YAML/JSON-LD schema files + entity files) into typed, JSON-LD-backed `KBNode`s
on top of the open node-type foundation (F1, #148).

> **The source repo is being sunset.** The real `content-model.md` + schema files
> are **not** in this repo yet. Everything here is built against the **fixtures**
> under `__tests__/fixtures/content-model/`, which define the contract the real
> files are expected to honour. When no content-model source is detected the
> pipeline is a **safe no-op** — existing graph output is byte-identical.

## Source shape

A `ContentModelSource` is a flat `{ root, files }` map (path → file contents),
produced by `readContentModel()` in `scripts/generate-manifest.js` (build time) or
`loadFixtureSource()` (tests). A source is considered **present** iff both
`teamops.yaml` and `index/context.jsonld` exist (`hasContentModelSource`).

```
content-model/
  teamops.yaml            # identity: authority + default (home) org
  index/context.jsonld    # CURIE prefix → URN base (the ONLY source of URN bases)
  schema/
    conventions.yaml      # per-kind: path, orgScoped, aliasField, companionExt
    edges.yaml            # FK / derived / deprecated edge rules
    lifecycle.yaml        # kind → lifecycle band
  people/ada.yaml         # entity files; kind comes from `@type`, NEVER the path
  squads/<org>/<id>.yaml  # org-scoped kinds may nest under a per-org subdir
  squads/<id>.md          # optional companion markdown (companionExt) merged into body
```

### Identity / URN rules

- URN **bases** come from the JSON-LD `@context` only (e.g. `squad` →
  `kg://xbox.com/squads/`); they are never hardcoded.
- A node's **kind** is its `@type`, never derived from the file path.
- Org-scoped kinds resolve to `{base}{org}/{id}`; authority-scoped kinds to
  `{base}{id}`. Org is detected from the file's location (flat file → default org;
  nested under `<org>/` → that org).
- `node.id === node.identity === <URN>`; `buildJsonLd()` writes the reserved keys
  (`@context`/`@id`/`@type`) last so entity `data` can never override them.

## The five passes (`builder.ts`)

1. **Schema** — `readContentModelSchema()` parses the five schema files.
2. **Walk + index** — discover entity files, parse them, detect org layout, and
   build a `(kind, org, id)` index plus an alias index for alias-FK resolution.
3. **Emit nodes** — one JSON-LD `KBNode` per entity (`display: 'entity'`,
   `entityType: <kind>`, `data` = verbatim parsed record; lifecycle band surfaced
   on `jsonld` only).
4. **Foreign keys** — resolve `scalar` / `array` / `composite` / `alias` FK edges
   from `edges.yaml`; unresolved refs become stub nodes (`data.unresolved`) with a
   diagnostic.
5. **Derived + deprecated** — `shared-target` rules pairwise-link entities sharing
   a resolved FK target (`relation: 'derived'`); deprecated rules are tagged
   `relation: 'deprecated'`.

Relationships are attached as **`connections` on the source node** (with a
`relation`), because the orchestrator ignores a provider's `edges` and `buildGraph`
derives edges from `connections`. The directed/typed `edges` array is also returned
for unit-test assertions.

## Wiring

- `ContentModelProvider` (`src/engine/providers/content-model-provider.ts`) wraps
  the builder as a `GraphProvider`. It is a no-op when the source is absent and
  registers the spine node types + bespoke viewers (`registerContentModelTypes()`)
  before emitting nodes.
- Registered in both `local-loader.ts` (fed `manifest.contentModel`) and
  `remote-loader.ts` (no-op seam until a remote fetch path lands).
- `scripts/generate-manifest.js` reads a `content-model/` directory at the repo
  root into `manifest.contentModel` (or `null`).

## Spine viewers (#164, #165)

`person`, `squad`, `workstream`, `mission`, `priority`, `cycle`, `org` each have a
bespoke viewer in `src/views/viewers/` (className-styled, SSR-safe, no pixel
sizing). They are bound to their kinds via the viewer registry in
`registerContentModelTypes()`; `GenericStructuredView` remains the fallback.
