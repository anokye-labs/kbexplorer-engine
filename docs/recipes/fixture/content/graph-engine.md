---
id: graph-engine
title: Graph Engine
cluster: engine
connections:
  - to: query-api
    description: Feeds the query API
  - to: sources
    description: Consumes sources
---
# Graph Engine

Builds a KBGraph from parsed nodes.
