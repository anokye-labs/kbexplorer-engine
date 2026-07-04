/**
 * Example local provider — Glossary.
 *
 * Demonstrates the local ES-module provider contract (F5a). It is authored
 * exactly like a third-party package would be: import `defineProvider` from
 * `@anokye-labs/kbexplorer-core`, default-export a factory, and read options off
 * the `ExternalProviderConfig`. No core or engine code is touched to add it.
 *
 * Reference it from config.yaml:
 *
 *   providers:
 *     - type: glossary               # advisory when `module` is set
 *       name: Glossary
 *       cluster: reference
 *       module: ./providers/examples/glossary-provider   # resolved by the loader
 *       options:
 *         terms:
 *           - id: knowledge-graph
 *             term: Knowledge Graph
 *             definition: A graph of entities and their relationships.
 *             connections: [graph-engine]
 */
import { defineProvider } from '@anokye-labs/kbexplorer-core'
import type { KBNode } from '@anokye-labs/kbexplorer-core'

interface GlossaryTerm {
  id: string
  term: string
  definition: string
  connections?: string[]
}

export default defineProvider((config) => {
  const cluster = config.cluster ?? 'reference'
  const id = `glossary-${config.name?.replace(/\s+/g, '-').toLowerCase() ?? 'default'}`
  const terms = (config.options?.terms as GlossaryTerm[] | undefined) ?? []

  return {
    id,
    name: config.name ?? 'Glossary',
    async resolve() {
      const nodes: KBNode[] = terms.map((entry) => ({
        id: `glossary-${entry.id}`,
        title: entry.term,
        cluster,
        content: `<h2>${entry.term}</h2><p>${entry.definition}</p>`,
        rawContent: `## ${entry.term}\n\n${entry.definition}`,
        emoji: 'Book',
        connections: (entry.connections ?? []).map((to) => ({
          to,
          description: 'Defines',
        })),
        source: { type: 'external', provider: id },
        provider: id,
      }))
      return { nodes, edges: [] }
    },
  }
})
