import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WikipediaProvider } from '../../providers/wikipedia-provider'
import { OrgChartProvider } from '../../providers/orgchart-provider'
import { loadExternalProviders } from '../../plugin-loader'
import type { ExternalProviderConfig, KBConfig } from '../../../types'
import { DEFAULT_CONFIG } from '../../../types'

// ── WikipediaProvider ──────────────────────────────────────

describe('WikipediaProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creates nodes from Wikipedia article summaries', async () => {
    const mockResponse = {
      title: 'Knowledge graph',
      extract: 'A knowledge graph is a structured representation.',
      extract_html: '<p>A knowledge graph is a structured representation.</p>',
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Knowledge_graph' } },
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const config: ExternalProviderConfig = {
      type: 'wikipedia',
      name: 'Reference',
      cluster: 'reference',
      options: {
        articles: [
          { title: 'Knowledge graph', connections: ['graph-engine'] },
        ],
      },
    }

    const provider = new WikipediaProvider(config)
    const result = await provider.resolve(DEFAULT_CONFIG, [])

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('wiki-knowledge-graph')
    expect(result.nodes[0].title).toBe('Knowledge graph')
    expect(result.nodes[0].cluster).toBe('reference')
    expect(result.nodes[0].source).toEqual({ type: 'external', provider: 'wikipedia-reference' })
    expect(result.nodes[0].connections).toHaveLength(1)
    expect(result.nodes[0].connections[0].to).toBe('graph-engine')
  })

  it('uses custom id when provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        title: 'React',
        extract: 'React is a library.',
        extract_html: '<p>React is a library.</p>',
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/React' } },
      }),
    } as Response)

    const provider = new WikipediaProvider({
      type: 'wikipedia',
      options: { articles: [{ title: 'React', id: 'react-framework' }] },
    })
    const result = await provider.resolve(DEFAULT_CONFIG, [])

    expect(result.nodes[0].id).toBe('react-framework')
  })

  it('handles fetch failures gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    } as Response)

    const provider = new WikipediaProvider({
      type: 'wikipedia',
      options: { articles: [{ title: 'Nonexistent Article' }] },
    })
    const result = await provider.resolve(DEFAULT_CONFIG, [])

    expect(result.nodes).toHaveLength(0)
  })
})

// ── OrgChartProvider ───────────────────────────────────────

describe('OrgChartProvider', () => {
  it('creates nodes with reports-to connections', async () => {
    const config: ExternalProviderConfig = {
      type: 'orgchart',
      name: 'Team',
      cluster: 'team',
      options: {
        people: [
          { id: 'ceo', name: 'Jane Smith', role: 'CEO' },
          { id: 'vp', name: 'John Doe', role: 'VP', reports: ['ceo'] },
        ],
      },
    }

    const provider = new OrgChartProvider(config)
    const result = await provider.resolve(DEFAULT_CONFIG, [])

    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[0].id).toBe('org-ceo')
    expect(result.nodes[0].title).toBe('Jane Smith')
    expect(result.nodes[1].id).toBe('org-vp')
    expect(result.nodes[1].connections).toEqual([
      { to: 'org-ceo', description: 'Reports to' },
    ])
  })

  it('creates cross-references to other graph nodes', async () => {
    const provider = new OrgChartProvider({
      type: 'orgchart',
      options: {
        people: [
          { id: 'dev', name: 'Alice', connections: ['app-shell', 'hud'] },
        ],
      },
    })
    const result = await provider.resolve(DEFAULT_CONFIG, [])

    expect(result.nodes[0].connections).toEqual([
      { to: 'app-shell', description: 'Owns' },
      { to: 'hud', description: 'Owns' },
    ])
  })

  it('handles empty people list', async () => {
    const provider = new OrgChartProvider({
      type: 'orgchart',
      options: { people: [] },
    })
    const result = await provider.resolve(DEFAULT_CONFIG, [])
    expect(result.nodes).toHaveLength(0)
  })
})

// ── Plugin Loader ──────────────────────────────────────────

describe('loadExternalProviders', () => {
  it('creates Wikipedia and OrgChart providers from config', () => {
    const configs: ExternalProviderConfig[] = [
      { type: 'wikipedia', name: 'Wiki', options: { articles: [] } },
      { type: 'orgchart', name: 'Team', options: { people: [] } },
    ]

    const providers = loadExternalProviders(configs)
    expect(providers).toHaveLength(2)
    expect(providers[0].id).toBe('wikipedia-wiki')
    expect(providers[1].id).toBe('orgchart-team')
  })

  it('warns on unknown provider type', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const providers = loadExternalProviders([
      { type: 'custom', name: 'Test' },
    ])
    expect(providers).toHaveLength(0)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('handles empty config array', () => {
    const providers = loadExternalProviders([])
    expect(providers).toHaveLength(0)
  })
})
