/**
 * WikipediaProvider — fetches Wikipedia article summaries and creates graph nodes.
 *
 * Config in config.yaml:
 *   providers:
 *     - type: wikipedia
 *       name: Reference Articles
 *       cluster: reference
 *       options:
 *         articles:
 *           - title: Knowledge graph
 *             connections: [graph-engine, type-system]
 *           - title: Force-directed graph drawing
 *             connections: [graph-network]
 *           - title: React (software)
 *             id: react-framework
 */
import type { GraphProvider, ProviderResult } from '../providers'
import type { KBConfig, KBNode, ExternalProviderConfig } from '../../types'

interface WikiArticleConfig {
  title: string
  id?: string
  cluster?: string
  connections?: string[]
}

interface WikiSummary {
  title: string
  extract: string
  extract_html: string
  content_urls: { desktop: { page: string } }
  thumbnail?: { source: string }
  description?: string
}

export class WikipediaProvider implements GraphProvider {
  id: string
  name: string
  dependencies: string[] = []

  private articles: WikiArticleConfig[]
  private defaultCluster: string

  constructor(config: ExternalProviderConfig) {
    this.id = `wikipedia-${config.name?.replace(/\s+/g, '-').toLowerCase() ?? 'default'}`
    this.name = config.name ?? 'Wikipedia'
    this.defaultCluster = config.cluster ?? 'reference'
    this.articles = (config.options?.articles as WikiArticleConfig[]) ?? []
  }

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    const nodes: KBNode[] = []

    const fetches = this.articles.map(async (article) => {
      try {
        const encoded = encodeURIComponent(article.title.replace(/\s+/g, '_'))
        const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`)
        if (!resp.ok) return null
        const data = await resp.json() as WikiSummary
        return { article, data }
      } catch {
        return null
      }
    })

    const results = await Promise.all(fetches)

    for (const result of results) {
      if (!result) continue
      const { article, data } = result

      const nodeId = article.id ?? `wiki-${data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
      const connections = (article.connections ?? []).map(to => ({
        to,
        description: `Referenced by ${data.title}`,
      }))

      const content = `<p>${data.extract_html ?? data.extract}</p>
<p><a href="${data.content_urls.desktop.page}" target="_blank">Read on Wikipedia →</a></p>`

      const rawContent = `${data.extract}\n\n[Read on Wikipedia →](${data.content_urls.desktop.page})`

      nodes.push({
        id: nodeId,
        title: data.title,
        cluster: article.cluster ?? this.defaultCluster,
        content,
        rawContent,
        emoji: 'Globe',
        connections,
        source: { type: 'external', provider: this.id },
        provider: this.id,
      })
    }

    return { nodes, edges: [] }
  }
}
