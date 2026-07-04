/**
 * Example third-party kbexplorer provider — Quotes.
 *
 * Authored exactly as a published npm package would be: it ships ESM + types,
 * depends on `@anokye-labs/kbexplorer-core` as a peer, default-exports a factory
 * wrapped in `defineProvider()`, and declares the provider-contract version +
 * capabilities it targets so a host can guard compatibility before loading it.
 *
 * Reference it from config.yaml by its *bare package specifier* (resolved from
 * node_modules — no core or engine code is touched to add it):
 *
 *   providers:
 *     - type: quotes                              # advisory when `module` is set
 *       name: Quotes
 *       cluster: reference
 *       module: '@anokye-labs/kbexplorer-example-quotes'
 *       options:
 *         quotes:
 *           - id: kay
 *             text: The best way to predict the future is to invent it.
 *             author: Alan Kay
 *             connections: [graph-engine]
 */
import { defineProvider, PROVIDER_API_VERSION } from '@anokye-labs/kbexplorer-core';

/** The provider-contract API version this package was authored against. */
export const apiVersion = PROVIDER_API_VERSION;

/** Capabilities this provider needs the host engine to support. */
export const capabilities = ['graph:nodes'];

export default defineProvider((config) => {
  const cluster = config.cluster ?? 'reference';
  const name = config.name ?? 'Quotes';
  const id = `quotes-${name.replace(/\s+/g, '-').toLowerCase()}`;
  const quotes = config.options?.quotes ?? [];

  return {
    id,
    name,
    async resolve() {
      const nodes = quotes.map((quote) => ({
        id: `quote-${quote.id}`,
        title: quote.author,
        cluster,
        content: `<blockquote>${quote.text}</blockquote><p>— ${quote.author}</p>`,
        rawContent: `> ${quote.text}\n\n— ${quote.author}`,
        emoji: 'Comment',
        connections: (quote.connections ?? []).map((to) => ({
          to,
          description: 'Quoted in',
        })),
        source: { type: 'external', provider: id },
        provider: id,
      }));
      return { nodes, edges: [] };
    },
  };
});
