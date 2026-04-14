/**
 * External provider plugin loader.
 *
 * Creates GraphProvider instances from ExternalProviderConfig entries
 * in config.yaml. Built-in types (wikipedia, orgchart) are resolved
 * directly; custom types can provide a module URL.
 */
import type { GraphProvider } from './providers'
import type { ExternalProviderConfig } from '../types'
import { WikipediaProvider } from './providers/wikipedia-provider'
import { OrgChartProvider } from './providers/orgchart-provider'

/**
 * Load external providers from config entries.
 * Returns an array of GraphProvider instances ready to register.
 */
export function loadExternalProviders(
  configs: ExternalProviderConfig[],
): GraphProvider[] {
  const providers: GraphProvider[] = []

  for (const config of configs) {
    switch (config.type) {
      case 'wikipedia':
        providers.push(new WikipediaProvider(config))
        break
      case 'orgchart':
        providers.push(new OrgChartProvider(config))
        break
      case 'custom':
        console.warn(`[kbexplorer] Custom provider type not yet supported: ${config.name}`)
        break
      default:
        console.warn(`[kbexplorer] Unknown provider type: ${config.type}`)
    }
  }

  return providers
}
