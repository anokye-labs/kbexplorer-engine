import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WikipediaProvider } from '../../providers/wikipedia-provider'
import { OrgChartProvider } from '../../providers/orgchart-provider'
import { loadExternalProviders } from '../../plugin-loader'
import type { ExternalProviderConfig } from '../../../types'
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
  it('creates Wikipedia and OrgChart providers from config', async () => {
    const configs: ExternalProviderConfig[] = [
      { type: 'wikipedia', name: 'Wiki', options: { articles: [] } },
      { type: 'orgchart', name: 'Team', options: { people: [] } },
    ]

    const providers = await loadExternalProviders(configs)
    expect(providers).toHaveLength(2)
    expect(providers[0].id).toBe('wikipedia-wiki')
    expect(providers[1].id).toBe('orgchart-team')
  })

  it('warns and skips a custom type with no module specifier', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const providers = await loadExternalProviders([
      { type: 'custom', name: 'Test' },
    ])
    expect(providers).toHaveLength(0)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('handles empty config array', async () => {
    const providers = await loadExternalProviders([])
    expect(providers).toHaveLength(0)
  })

  // ── Local ES-module loading (F5a) ──────────────────────────
  it('loads a local ES-module provider by specifier and contributes nodes', async () => {
    const providers = await loadExternalProviders([
      {
        type: 'glossary',
        name: 'Glossary',
        cluster: 'reference',
        module: './providers/examples/glossary-provider',
        options: {
          terms: [
            {
              id: 'knowledge-graph',
              term: 'Knowledge Graph',
              definition: 'A graph of entities and relationships.',
              connections: ['graph-engine'],
            },
          ],
        },
      },
    ])

    expect(providers).toHaveLength(1)
    expect(providers[0].id).toBe('glossary-glossary')

    const result = await providers[0].resolve(DEFAULT_CONFIG, [])
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('glossary-knowledge-graph')
    expect(result.nodes[0].title).toBe('Knowledge Graph')
    expect(result.nodes[0].cluster).toBe('reference')
    expect(result.nodes[0].source).toEqual({ type: 'external', provider: 'glossary-glossary' })
    expect(result.nodes[0].connections).toEqual([
      { to: 'graph-engine', description: 'Defines' },
    ])
  })

  it('warns and skips a non-local (bare/absolute/URL) module specifier', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const providers = await loadExternalProviders([
      { type: 'custom', name: 'Remote', module: 'https://evil.example/provider.js' },
      { type: 'custom', name: 'Bare', module: 'some-npm-package' },
    ])
    expect(providers).toHaveLength(0)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('warns and skips when a module specifier cannot be resolved', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const providers = await loadExternalProviders([
      { type: 'custom', name: 'Broken', module: './providers/examples/does-not-exist' },
    ])
    expect(providers).toHaveLength(0)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
