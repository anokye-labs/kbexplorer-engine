/**
 * OrgChartProvider — creates an organizational chart as graph nodes.
 *
 * Config in config.yaml:
 *   providers:
 *     - type: orgchart
 *       name: Team Structure
 *       cluster: team
 *       options:
 *         people:
 *           - id: ceo
 *             name: Jane Smith
 *             role: CEO
 *             reports: []
 *           - id: vp-eng
 *             name: John Doe
 *             role: VP Engineering
 *             reports: [ceo]
 *           - id: lead-fe
 *             name: Alice Chen
 *             role: Frontend Lead
 *             reports: [vp-eng]
 *             connections: [app-shell, hud]
 */
import type { GraphProvider, ProviderResult } from '../providers'
import type { KBConfig, KBNode, ExternalProviderConfig } from '../../types'

interface PersonConfig {
  id: string
  name: string
  role?: string
  reports?: string[]
  connections?: string[]
  emoji?: string
}

export class OrgChartProvider implements GraphProvider {
  id: string
  name: string
  dependencies: string[] = []

  private people: PersonConfig[]
  private defaultCluster: string

  constructor(config: ExternalProviderConfig) {
    this.id = `orgchart-${config.name?.replace(/\s+/g, '-').toLowerCase() ?? 'default'}`
    this.name = config.name ?? 'Org Chart'
    this.defaultCluster = config.cluster ?? 'team'
    this.people = (config.options?.people as PersonConfig[]) ?? []
  }

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    const nodes: KBNode[] = []

    for (const person of this.people) {
      const connections: Array<{ to: string; description: string }> = []

      // Reports-to edges
      for (const managerId of person.reports ?? []) {
        connections.push({
          to: `org-${managerId}`,
          description: `Reports to`,
        })
      }

      // Cross-references to other graph nodes
      for (const target of person.connections ?? []) {
        connections.push({
          to: target,
          description: `Owns`,
        })
      }

      const role = person.role ?? ''
      const content = `<h2>${person.name}</h2><p><strong>${role}</strong></p>`
      const rawContent = `## ${person.name}\n\n**${role}**`

      nodes.push({
        id: `org-${person.id}`,
        title: person.name,
        cluster: this.defaultCluster,
        content,
        rawContent,
        emoji: person.emoji ?? 'Person',
        connections,
        source: { type: 'external', provider: this.id },
        provider: this.id,
      })
    }

    return { nodes, edges: [] }
  }
}
