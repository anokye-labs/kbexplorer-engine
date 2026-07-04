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
})
