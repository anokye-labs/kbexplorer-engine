import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadExternalProvidersMock = vi.hoisted(() => vi.fn())
const orchestrateWithTransformsMock = vi.hoisted(() => vi.fn())

vi.mock('../plugin-loader', () => ({
  loadExternalProviders: loadExternalProvidersMock,
}))

vi.mock('../orchestrator', () => ({
  orchestrateWithTransforms: orchestrateWithTransformsMock,
}))

import { loadKnowledgeBase } from '../loader'

function createRepoData() {
  return {
    tree: [],
    authoredContent: {},
    nodemapRaw: undefined,
    nodemapFiles: [],
    nodemapDirs: [],
    listFiles: async () => [],
    pullRequests: [],
    issues: [],
    commits: [],
    branches: [],
    repoMetadata: {},
    releases: [],
    structuralFiles: {},
    structuredNodeMapRaw: undefined,
    contentModel: {},
    readme: '',
  }
}

describe('loadKnowledgeBase', () => {
  beforeEach(() => {
    loadExternalProvidersMock.mockReset()
    loadExternalProvidersMock.mockResolvedValue([])
    orchestrateWithTransformsMock.mockReset()
    orchestrateWithTransformsMock.mockResolvedValue({ nodes: [], edges: [] })
  })

  it('threads importBaseUrl through to external provider loading only when provided', async () => {
    const source = {
      getRepoData: vi.fn().mockResolvedValue(createRepoData()),
    }
    const config = {
      providers: [{ type: 'custom', name: 'Test' }],
    }

    await loadKnowledgeBase(source as any, config as any, undefined, {
      importBaseUrl: 'https://example.com/',
    })

    expect(loadExternalProvidersMock).toHaveBeenNthCalledWith(
      1,
      config.providers,
      { importBaseUrl: 'https://example.com/' },
    )

    loadExternalProvidersMock.mockClear()

    await loadKnowledgeBase(source as any, config as any)

    expect(loadExternalProvidersMock).toHaveBeenNthCalledWith(1, config.providers, undefined)
  })

  it('positional form returns { graph, config } (template-pinned contract)', async () => {
    orchestrateWithTransformsMock.mockResolvedValue({ nodes: [{ id: 'x' }], edges: [] })
    const source = { getRepoData: vi.fn().mockResolvedValue(createRepoData()) }
    const config = { title: 'T', source: { owner: 'o', repo: 'r' } }

    const result = await loadKnowledgeBase(source as any, config as any)

    expect(result).toHaveProperty('graph')
    expect(result).toHaveProperty('config')
    expect((result as any).config).toBe(config)
    expect((result as any).graph).toEqual({ nodes: [{ id: 'x' }], edges: [] })
    expect(source.getRepoData).toHaveBeenCalledTimes(1)
  })

  it('config-first form returns the bare graph and uses the supplied source', async () => {
    orchestrateWithTransformsMock.mockResolvedValue({ nodes: [{ id: 'y' }], edges: [] })
    const source = { getRepoData: vi.fn().mockResolvedValue(createRepoData()) }
    const config = { title: 'T', source: { owner: 'o', repo: 'r' }, providers: [] }

    const graph = await loadKnowledgeBase(config as any, { source: source as any })

    // Bare graph, not the { graph, config } envelope.
    expect(graph).toEqual({ nodes: [{ id: 'y' }], edges: [] })
    expect(graph).not.toHaveProperty('config')
    expect(source.getRepoData).toHaveBeenCalledTimes(1)
  })

  it('config-first form threads importBaseUrl and env through', async () => {
    orchestrateWithTransformsMock.mockResolvedValue({ nodes: [], edges: [] })
    const source = { getRepoData: vi.fn().mockResolvedValue(createRepoData()) }
    const config = { title: 'T', source: { owner: 'o', repo: 'r' }, providers: [{ type: 'custom', name: 'P' }] }

    await loadKnowledgeBase(config as any, {
      source: source as any,
      importBaseUrl: 'https://example.com/',
    })

    expect(loadExternalProvidersMock).toHaveBeenNthCalledWith(
      1,
      config.providers,
      { importBaseUrl: 'https://example.com/' },
    )
  })
})
