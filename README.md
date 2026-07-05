# @anokye-labs/kbexplorer-engine

The runtime-agnostic engine for kbexplorer: it turns a knowledge-base source
(a manifest, the GitHub API, or a local directory) into a computed `KBGraph`,
and provides a small scriptable query API over that graph. The core (`.`) entry
stays portable across Node and browser-like environments; Node-specific pieces
(like `FileSystemSource`) live behind the `./sources` subpath.

## Develop

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Package shape

- `.` — the engine core: graph building (`buildGraph`), the unified loader
  (`loadKnowledgeBase`), the query helpers, providers, parsing, identity, and
  supporting types.
- `./sources` — source adapters (`ManifestSource`, `GitHubApiSource`,
  `FileSystemSource`) and the `RepoSource` / `RepoData` contracts.
- `./store` — the optional sqlite-backed graph store entry point.

## Loading a knowledge base

`loadKnowledgeBase` has two call shapes, distinguished by the first argument:

```ts
import { loadKnowledgeBase } from '@anokye-labs/kbexplorer-engine';
import { GitHubApiSource, FileSystemSource } from '@anokye-labs/kbexplorer-engine/sources';

// Config-first (scripting): returns a bare KBGraph.
// With no `source`, a GitHubApiSource is built from config.source.
const graph = await loadKnowledgeBase(config);
const localGraph = await loadKnowledgeBase(config, { source: new FileSystemSource('./my-kb') });

// Positional (advanced): returns { graph, config }. This is the SHA-pinned
// contract consumed by kbexplorer-template — it is unchanged.
const { graph: g, config: c } = await loadKnowledgeBase(new GitHubApiSource(config.source), config);
```

The two forms differ only in ergonomics and return shape; the positional form
is fully preserved.

## Query API

Pure, runtime-agnostic helpers over a computed `KBGraph`:

```ts
import {
  getNode, findNodes, neighbors, related, subgraph, shortestPath,
} from '@anokye-labs/kbexplorer-engine';

getNode(graph, 'home');                         // KBNode | undefined
findNodes(graph, n => n.cluster === 'engine');  // KBNode[]
neighbors(graph, 'home', { direction: 'out' }); // KBNode[]
related(graph, 'home');                          // KBNode[] (precomputed index)
subgraph(graph, 'home', { radius: 2 });          // KBGraph neighborhood
shortestPath(graph, 'home', 'loader');           // string[] | null
```

## Sources

- `ManifestSource(manifest, config)` — a frozen, pre-built snapshot.
- `GitHubApiSource(sourceConfig)` — the live GitHub API.
- `FileSystemSource(rootDir, options?)` — **Node-only** adapter that walks a
  local directory into the same `RepoData` bundle a manifest yields (authored
  `content/`, `.github` structural files, `content-model/`, README).

## Recipes

Runnable examples of the scriptable API against an in-repo fixture live in
[`docs/recipes.md`](./docs/recipes.md). CI builds the package and runs all eight
scripts on every pull request.
