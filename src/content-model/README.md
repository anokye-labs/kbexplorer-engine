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
  index/vocabulary.jsonld # OPTIONAL cross-repo synonym layer — alias term → canonical kind (#153)
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

## Cross-repo vocabulary / synonym layer (#153)

Different repos use different words for the same concept — one calls a team a
`squad`, another a `cell`, another a `crew`; one calls an iteration a `cycle`,
another a `season`. This optional layer maps each repo's **alias term** to a
**canonical kind** so the graph unifies them under one `@type` (and one viewer),
**while every repo keeps its native label**.

It is **data-driven** (never hardcoded), authored exactly like the rest of the
JSON-LD context, and a **strictly additive safe no-op**: with no vocabulary
declared, graph output is byte-identical to before.

**Two ways to declare aliases**, merged together (overlay wins on collision):

1. **Per-repo file** — `index/vocabulary.jsonld`, a JSON-LD `@context` whose
   entries alias a term to a canonical kind/CURIE prefix already in
   `context.jsonld`. Values are a bare string or `{ "@id": … }`, mirroring how
   prefixes are authored:

   ```jsonc
   { "@context": { "cell": "squad", "crew": { "@id": "squad" }, "season": "cycle" } }
   ```

2. **Shared overlay** — a vocabulary supplied *independently of any single repo's
   files* (the cross-repo layer). `readContentModelSchema(source, overlay)`,
   `buildContentModel(source, overlay)` and `new ContentModelProvider(source,
   overlay)` all accept it as either raw `vocabulary.jsonld` text (a string) or a
   parsed `{ aliases }` `Vocabulary`. Its terms override the per-repo file.

**Resolution** (`canonicalKind(schema, term)` = `aliases[term] ?? term`) happens
in the builder's *walk* pass, **before** convention / URN / cluster / entityType
resolution — so an alias like `cell` (which has no convention or CURIE prefix of
its own) resolves to `squad` and gets the squad convention, URN base, cluster and
the bespoke `SquadView`. Resolution is a single hop (a canonical target is itself
a real kind, not another alias); self-mappings and JSON-LD keywords are ignored.

**Native label preserved.** The entity's `data` stays the verbatim parsed record,
so `data['@type']` keeps the native term (`cell`). Additionally the builder
surfaces it on the JSON-LD envelope as `jsonld.nativeType` — and *only* for
aliased nodes, so non-aliased output stays byte-identical. Spine viewers read it
via `nativeTypeOf(node)` and show a small "native: …" badge next to the canonical
type.

## The five passes (`builder.ts`)

1. **Schema** — `readContentModelSchema()` parses the five schema files (plus the
   optional `index/vocabulary.jsonld` synonym layer and any shared overlay).
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
