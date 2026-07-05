# Recipes

Runnable scripts that exercise the scriptable engine API against a small
fixture knowledge base checked into this repo at
[`docs/recipes/fixture/`](./recipes/fixture). Each script is a standalone Node
ES module that imports the **built** package from `dist/`, so build first:

```bash
npm run build
node docs/recipes/01-load-from-filesystem.mjs
```

Run them all:

```bash
npm run build
for f in docs/recipes/0*.mjs; do echo "== $f =="; node "$f"; done
```

The fixture is a five-page authored KB (`home`, `graph-engine`, `query-api`,
`sources`, `loader`) whose frontmatter `connections` form this graph:

```
home ─▶ graph-engine ─▶ sources ─▶ loader ─▶ (back to sources)
  └───▶ query-api ◀──────┘
```

> Loading the fixture through the full pipeline also materializes file/tree
> nodes (`file-content/…`, `dir-content`, `repo-root`) via the FilesProvider —
> that is the real engine output, not noise. The authored nodes above are the
> ones the query recipes focus on.

## The recipes

| # | Script | Demonstrates |
|---|--------|--------------|
| 01 | [`01-load-from-filesystem.mjs`](./recipes/01-load-from-filesystem.mjs) | `FileSystemSource` + config-first `loadKnowledgeBase(config, { source })` → bare `KBGraph` |
| 02 | [`02-get-node.mjs`](./recipes/02-get-node.mjs) | `getNode(graph, id)` |
| 03 | [`03-find-nodes.mjs`](./recipes/03-find-nodes.mjs) | `findNodes(graph, predicate)` |
| 04 | [`04-neighbors.mjs`](./recipes/04-neighbors.mjs) | `neighbors(graph, id, { direction, edgeType })` |
| 05 | [`05-related.mjs`](./recipes/05-related.mjs) | `related(graph, id)` (precomputed index) |
| 06 | [`06-subgraph.mjs`](./recipes/06-subgraph.mjs) | `subgraph(graph, seeds, { radius })` |
| 07 | [`07-shortest-path.mjs`](./recipes/07-shortest-path.mjs) | `shortestPath(graph, from, to, { direction })` |
| 08 | [`08-positional-loader.mjs`](./recipes/08-positional-loader.mjs) | Positional `loadKnowledgeBase(source, config)` → `{ graph, config }` |

## Expected output

The fixture is deterministic; the scripts print stable output.

### 01 — load from filesystem

```
nodes: 12
ids: dir-content, file-content/graph-engine.md, file-content/home.md, file-content/loader.md, file-content/query-api.md, file-content/sources.md, graph-engine, home, loader, query-api, repo-root, sources
edges: 17
clusters: bug, code, commits, docs, engine, epic, feature, infra, pull-request, releases, task
```

### 02 — getNode

```
found: home - Home
cluster: docs
missing: undefined
```

### 03 — findNodes

```
engine nodes: graph-engine, loader, query-api, sources
titles containing "Graph": Graph Engine
```

### 04 — neighbors

```
graph-engine (both): file-content/graph-engine.md, home, query-api, sources
graph-engine (out): file-content/graph-engine.md, query-api, sources
graph-engine (in): home
```

### 05 — related

```
related to home: file-content/home.md, graph-engine, query-api
related to query-api: file-content/query-api.md, graph-engine, home
```

### 06 — subgraph

```
radius 1 from home: file-content/home.md, graph-engine, home, query-api
radius 2 from home: dir-content, file-content/graph-engine.md, file-content/home.md, file-content/query-api.md, graph-engine, home, query-api, sources
radius 2 edges: 10
radius 2 clusters: docs, engine, infra
```

### 07 — shortestPath

```
home -> loader: home -> graph-engine -> sources -> loader
home -> home: home
home -> ghost: null
```

### 08 — positional loader

```
return keys: config, graph
graph nodes: 12
config title: kbexplorer
```

## CI

The `recipes` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
builds the package and runs all eight scripts on every pull request, so the
public API surface they document can never silently regress.
