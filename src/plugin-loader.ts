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
 *      a provider can be added with no core code change. The specifier may be a
 *      **local** relative path (`./`, `../`) or a **bare npm package** name
 *      (`pkg`, `@scope/pkg`, `pkg/subpath`) resolved from `node_modules`;
 *      absolute paths and URL/scheme specifiers are rejected so the loader
 *      never executes arbitrary remote code. A third-party module is guarded
 *      against the provider-contract version + capabilities it declares
 *      ({@link checkProviderCompatibility}) and skipped with a clear message if
 *      incompatible, rather than crashing the build.
 *   2. **First-party built-in** — `wikipedia` / `orgchart` are resolved directly.
 *
 * Providers authored against the core contract expose a `resolve(context)`
 * signature; the template engine runs providers as `resolve(config, existing)`.
 * {@link adaptCoreProvider} bridges the two so a single contract serves both
 * local modules and (later) third-party npm packages.
 */
import type { GraphProvider, ProviderResult } from './providers'
import type { ExternalProviderConfig, KBConfig, KBNode } from '@anokye-labs/kbexplorer-core'
import type {
  GraphProvider as CoreGraphProvider,
  ProviderCapability,
  ProviderHostContract,
  ProviderModule,
} from '@anokye-labs/kbexplorer-core'
import {
  PROVIDER_API_VERSION,
  checkProviderCompatibility,
} from '@anokye-labs/kbexplorer-core'
import { isAbsolute, resolve, sep as pathSep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WikipediaProvider } from './providers/wikipedia-provider'
import { OrgChartProvider } from './providers/orgchart-provider'

/**
 * What this host engine advertises to the provider-compatibility guard: the
 * provider-contract version it implements and the capabilities it can satisfy.
 * The template runs providers via {@link adaptCoreProvider}, contributing nodes
 * and edges to the graph but not (yet) populating the `sources` map on the
 * provider context — so a provider that requires `sources` is incompatible.
 */
const HOST_CONTRACT: ProviderHostContract = {
  apiVersion: PROVIDER_API_VERSION,
  capabilities: ['graph:nodes', 'graph:edges'] satisfies ProviderCapability[],
}

/** How a `module` specifier resolves (or why it is refused). */
type SpecifierKind = 'local' | 'bare' | 'rejected'

export interface LoadExternalProvidersOptions {
  importBaseUrl?: string | URL
}

function resolveImportBaseUrl(importBaseUrl: string | URL): URL {
  if (importBaseUrl instanceof URL) {
    const normalizedBaseUrl = new URL(importBaseUrl.href)
    if (normalizedBaseUrl.protocol === 'file:' && !normalizedBaseUrl.pathname.endsWith('/')) {
      normalizedBaseUrl.pathname = `${normalizedBaseUrl.pathname}/`
    }
    return normalizedBaseUrl
  }

  if (importBaseUrl.startsWith('file:')) {
    const normalizedBaseUrl = new URL(importBaseUrl)
    if (normalizedBaseUrl.protocol === 'file:' && !normalizedBaseUrl.pathname.endsWith('/')) {
      normalizedBaseUrl.pathname = `${normalizedBaseUrl.pathname}/`
    }
    return normalizedBaseUrl
  }

  const absolutePath = isAbsolute(importBaseUrl)
    ? importBaseUrl
    : resolve(importBaseUrl)
  const normalizedPath = absolutePath.endsWith(pathSep)
    ? absolutePath
    : `${absolutePath}${pathSep}`

  return pathToFileURL(normalizedPath)
}

/**
 * Classify a `module` specifier. Relative paths are local; bare package names
 * (incl. `@scope/pkg` and subpaths) resolve from `node_modules`. Anything with
 * a URL scheme (`https:`, `file:`, `node:`, …), a Windows drive, or an absolute
 * POSIX path is rejected — those could pull in arbitrary/remote code.
 */
function classifySpecifier(specifier: string): SpecifierKind {
  if (specifier.startsWith('./') || specifier.startsWith('../')) return 'local'
  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier) ||
    specifier.startsWith('/') ||
    specifier.startsWith('\\')
  ) {
    return 'rejected'
  }
  return 'bare'
}

/**
 * Adapt a core-contract provider (`resolve(context)`) to the template engine's
 * runtime provider (`resolve(config, existingNodes)`). The graph types are the
 * same (template re-exports them from core), so only the call shape differs.
 */
function adaptCoreProvider(provider: CoreGraphProvider): GraphProvider {
  return {
    id: provider.id,
    name: provider.name,
    dependencies: provider.dependencies ?? [],
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
  options?: LoadExternalProvidersOptions,
): Promise<GraphProvider | null> {
  const specifier = config.module
  if (!specifier) return null
  // Local relative paths (F5a) and bare npm package specifiers (F5b) are
  // allowed; absolute paths and URL/scheme specifiers are refused so the loader
  // never executes arbitrary remote code.
  if (classifySpecifier(specifier) === 'rejected') {
    console.warn(
      `[kbexplorer] Provider module "${specifier}" is not a local (\`./\`, \`../\`) or bare npm package specifier; absolute/URL specifiers are not supported (no remote code execution). Skipping.`,
    )
    return null
  }

  const importTarget =
    classifySpecifier(specifier) === 'local' && options?.importBaseUrl
      ? new URL(specifier, resolveImportBaseUrl(options.importBaseUrl)).href
      : specifier

  try {
    const mod = (await import(/* @vite-ignore */ importTarget)) as Partial<ProviderModule>
    const factory = mod.default
    if (typeof factory !== 'function') {
      console.warn(
        `[kbexplorer] Provider module "${specifier}" has no default-export factory (use defineProvider()).`,
      )
      return null
    }
    // Guard third-party providers against the contract version + capabilities
    // they declare; skip (don't crash) an incompatible one with a clear reason.
    const compat = checkProviderCompatibility(mod, HOST_CONTRACT)
    if (!compat.compatible) {
      console.warn(
        `[kbexplorer] Provider module "${specifier}" ${compat.reason}. Skipping.`,
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
  options?: LoadExternalProvidersOptions,
): Promise<GraphProvider[]> {
  const providers: GraphProvider[] = []

  for (const config of configs) {
    // A module specifier takes precedence and works for any `type`.
    if (config.module) {
      const provider = await loadModuleProvider(config, options)
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
