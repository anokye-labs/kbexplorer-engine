/**
 * External provider plugin loader.
 *
 * Builds {@link GraphProvider} instances from the `providers` entries in
 * config.yaml. Two resolution paths:
 *
 *   1. **Local / third-party module** — when an entry sets `module`, the loader
 *      dynamic-imports that ES-module specifier and calls its default export
 *      (a `ProviderFactory` created with `defineProvider()` from
 *      `@anokye-labs/kbexplorer-core`). This is the headline extensibility path:
 *      a provider can be added with no core code change.
 *   2. **First-party built-in** — `wikipedia` / `orgchart` are resolved directly.
 *
 * Providers authored against the core contract expose a `resolve(context)`
 * signature; the template engine runs providers as `resolve(config, existing)`.
 * {@link adaptCoreProvider} bridges the two so a single contract serves both
 * local modules and (later) third-party npm packages.
 */
import type { GraphProvider, ProviderResult } from './providers'
import type { ExternalProviderConfig, KBConfig, KBNode } from '../types'
import type {
  GraphProvider as CoreGraphProvider,
  ProviderModule,
} from '@anokye-labs/kbexplorer-core'
import { WikipediaProvider } from './providers/wikipedia-provider'
import { OrgChartProvider } from './providers/orgchart-provider'

/**
 * Adapt a core-contract provider (`resolve(context)`) to the template engine's
 * runtime provider (`resolve(config, existingNodes)`). The graph types are the
 * same (template re-exports them from core), so only the call shape differs.
 */
function adaptCoreProvider(provider: CoreGraphProvider): GraphProvider {
  return {
    id: provider.id,
    name: provider.name,
    dependencies: provider.dependencies,
    async resolve(config: KBConfig, existingNodes: KBNode[]): Promise<ProviderResult> {
      const { nodes, edges } = await provider.resolve({ config, existingNodes })
      return { nodes, edges }
    },
  }
}

/**
 * Dynamic-import a provider declared by ES-module specifier and instantiate it.
 * Returns null (with a warning) if the module can't be loaded or doesn't expose
 * a default-export factory.
 */
async function loadModuleProvider(
  config: ExternalProviderConfig,
): Promise<GraphProvider | null> {
  const specifier = config.module
  if (!specifier) return null
  // F5a scopes loading to *local* modules: only relative specifiers are allowed.
  // This keeps arbitrary bare/absolute/URL specifiers (which could execute
  // unexpected code) out; third-party package specifiers arrive in F5b.
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    console.warn(
      `[kbexplorer] Provider module "${specifier}" is not a local (\`./\` or \`../\`) specifier; only local modules are supported (third-party packages: F5b). Skipping.`,
    )
    return null
  }
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as Partial<ProviderModule>
    const factory = mod.default
    if (typeof factory !== 'function') {
      console.warn(
        `[kbexplorer] Provider module "${specifier}" has no default-export factory (use defineProvider()).`,
      )
      return null
    }
    return adaptCoreProvider(factory(config))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[kbexplorer] Failed to load provider module "${specifier}": ${message}`)
    return null
  }
}

/**
 * Load external providers from config entries, in declared order. Module-backed
 * entries are dynamic-imported; built-in types are resolved directly. The
 * registry topo-sorts the returned providers by their `dependencies`.
 */
export async function loadExternalProviders(
  configs: ExternalProviderConfig[],
): Promise<GraphProvider[]> {
  const providers: GraphProvider[] = []

  for (const config of configs) {
    // A module specifier takes precedence and works for any `type`.
    if (config.module) {
      const provider = await loadModuleProvider(config)
      if (provider) providers.push(provider)
      continue
    }

    switch (config.type) {
      case 'wikipedia':
        providers.push(new WikipediaProvider(config))
        break
      case 'orgchart':
        providers.push(new OrgChartProvider(config))
        break
      default:
        console.warn(
          `[kbexplorer] Provider "${config.name ?? config.type}" is not a built-in type and declares no "module" specifier; skipping.`,
        )
    }
  }

  return providers
}
