import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../providers';
import { collectProviderNodes } from '../orchestrator';
import { StructuralProvider } from '../providers/structural-provider';
import { WorkProvider } from '../providers/work-provider';
import { buildGraph } from '../graph';
import { resetNodeTypeRegistry } from '../node-types';
import { resetViewerRegistry } from '../../views/viewers';
import type { KBConfig } from '../../types';
import { DEFAULT_CONFIG } from '../../types';

const config: KBConfig = DEFAULT_CONFIG;

const WORKFLOW = `name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;

const repoMetadata = {
  name: 'demo-repo',
  description: 'A demo',
  html_url: 'https://github.com/acme/demo-repo',
  default_branch: 'main',
  stargazers_count: 0,
  forks_count: 0,
  private: false,
  topics: [] as string[],
  primary_language: 'TypeScript',
  languages: [] as Array<{ name: string; size: number }>,
  owner: { login: 'acme', avatar_url: '' },
};

describe('structural graph integration (#167)', () => {
  beforeEach(() => {
    resetNodeTypeRegistry();
    resetViewerRegistry();
  });

  it('materialises a structural edge from a .github workflow node to the repository node', async () => {
    const registry = new ProviderRegistry();
    registry.register(new WorkProvider([], [], [], [], repoMetadata));
    registry.register(new StructuralProvider({ '.github/workflows/ci.yml': WORKFLOW }));

    const nodes = await collectProviderNodes(registry, config);
    const graph = buildGraph(nodes, []);

    const repo = graph.nodes.find(n => n.id === 'repo-meta');
    const workflow = graph.nodes.find(n => n.entityType === 'workflow');
    expect(repo, 'repository node should exist').toBeDefined();
    expect(workflow, 'workflow node should exist').toBeDefined();

    const edge = graph.edges.find(
      e =>
        (e.from === workflow!.id && e.to === 'repo-meta') ||
        (e.from === 'repo-meta' && e.to === workflow!.id),
    );
    expect(edge, 'workflow → repo-meta edge should exist').toBeDefined();
    expect(edge?.relation).toBe('structural');
  });

  it('still produces the workflow node when no repository node exists (orphan-safe)', async () => {
    const registry = new ProviderRegistry();
    registry.register(new WorkProvider([], [], [])); // no repoMetadata → no repo-meta
    registry.register(new StructuralProvider({ '.github/workflows/ci.yml': WORKFLOW }));

    const nodes = await collectProviderNodes(registry, config);
    const graph = buildGraph(nodes, []);

    const workflow = graph.nodes.find(n => n.entityType === 'workflow');
    expect(workflow).toBeDefined();
    // No repo-meta target, but the node is still reachable via orphan fallback.
    const hasEdge = graph.edges.some(e => e.from === workflow!.id || e.to === workflow!.id);
    expect(hasEdge).toBe(true);
  });
});
