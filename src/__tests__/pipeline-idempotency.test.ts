/**
 * Full-pipeline regression + drift check (F4 / T4.2 — issue #170).
 *
 * Proves the build/assembly pipeline (content-model builder + provider
 * orchestration) is **idempotent**: re-running with unchanged sources produces
 * byte-identical output. This is the "do I need to re-run after source changes?"
 * guarantee — if sources didn't change, output won't either.
 *
 * Also asserts the **safe-no-op invariants**: an absent content-model source and
 * an absent `.github` directory leave the existing graph output unchanged
 * (byte-identical), so the new node-type system is strictly additive.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { KBConfig, KBNode } from '@anokye-labs/kbexplorer-core';
import type { GraphProvider, ProviderResult } from '../providers';
import { ProviderRegistry } from '../providers';
import { orchestrate } from '../orchestrator';
import { buildContentModel } from '../content-model';
import { ContentModelProvider } from '../providers/content-model-provider';
import { StructuralProvider } from '../providers/structural-provider';
import { resetNodeTypeRegistry } from '../node-types';
import { DEFAULT_CONFIG } from '../default-config';
import { loadFixtureSource } from '../content-model/__tests__/fixtures';

const config: KBConfig = DEFAULT_CONFIG;

/** A minimal `.github` source: one workflow + CODEOWNERS, enough to exercise
 *  the structural provider and the workflow → repo-meta `structural` edge. */
const STRUCTURAL_FILES: Record<string, string> = {
  '.github/workflows/ci.yml': 'name: CI\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n',
  '.github/CODEOWNERS': '* @octocat\n',
};

/** Fixed baseline provider standing in for the repo's real (work-layer) nodes. */
function fixedNode(id: string, cluster: string): KBNode {
  return {
    id,
    title: id,
    cluster,
    content: '',
    rawContent: '',
    connections: [],
    source: { type: 'readme' },
  };
}

class BaselineProvider implements GraphProvider {
  id = 'work';
  name = 'Baseline';
  dependencies: string[] = [];
  async resolve(): Promise<ProviderResult> {
    return { nodes: [fixedNode('repo-meta', 'infra'), fixedNode('readme', 'docs')], edges: [] };
  }
}

afterEach(() => {
  resetNodeTypeRegistry();
});

describe('content-model builder idempotency (#170)', () => {
  it('produces byte-identical output across re-runs with unchanged sources', () => {
    const src = loadFixtureSource();
    const first = JSON.stringify(buildContentModel(src));
    const second = JSON.stringify(buildContentModel(src));
    expect(second).toBe(first);
  });

  it('does not depend on input file ordering (object-key order is normalized)', () => {
    const src = loadFixtureSource();
    const reordered = { root: src.root, files: Object.fromEntries(Object.entries(src.files).reverse()) };
    expect(JSON.stringify(buildContentModel(reordered))).toBe(JSON.stringify(buildContentModel(src)));
  });
});

describe('full-pipeline orchestration idempotency (#170)', () => {
  function freshRegistry(): ProviderRegistry {
    const r = new ProviderRegistry();
    r.register(new BaselineProvider());
    r.register(new ContentModelProvider(loadFixtureSource()));
    r.register(new StructuralProvider(STRUCTURAL_FILES, null));
    return r;
  }

  it('re-running the assembly produces a byte-identical graph (no drift)', async () => {
    const first = JSON.stringify(await orchestrate(freshRegistry(), config));
    const second = JSON.stringify(await orchestrate(freshRegistry(), config));
    expect(second).toBe(first);
  });

  it('emits the workflow → repo-meta structural edge through assembly', async () => {
    const graph = await orchestrate(freshRegistry(), config);
    const workflow = graph.nodes.find(n => n.entityType === 'workflow');
    expect(workflow).toBeTruthy();
    expect(
      workflow!.connections.some(c => c.relation === 'structural' && c.to === 'repo-meta'),
    ).toBe(true);
  });
});

describe('safe-no-op invariants (#170)', () => {
  it('content-model + structural providers are empty no-ops when sources are absent', async () => {
    expect(await new ContentModelProvider(null).resolve(config, [])).toEqual({ nodes: [], edges: [] });
    expect(await new ContentModelProvider({ root: 'x', files: {} }).resolve(config, [])).toEqual({
      nodes: [],
      edges: [],
    });
    expect(await new StructuralProvider({}, null).resolve(config, [])).toEqual({ nodes: [], edges: [] });
  });

  it('absent content-model / absent .github leaves the graph output byte-identical', async () => {
    const baseline = new ProviderRegistry();
    baseline.register(new BaselineProvider());

    const withEmptyProviders = new ProviderRegistry();
    withEmptyProviders.register(new BaselineProvider());
    withEmptyProviders.register(new ContentModelProvider(null));
    withEmptyProviders.register(new StructuralProvider({}, null));

    const baseGraph = JSON.stringify(await orchestrate(baseline, config));
    const withEmpty = JSON.stringify(await orchestrate(withEmptyProviders, config));
    expect(withEmpty).toBe(baseGraph);
  });
});
