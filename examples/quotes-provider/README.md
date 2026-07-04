# @anokye-labs/kbexplorer-example-quotes

A minimal **third-party kbexplorer provider** demonstrating the distributable,
loadable-provider contract end-to-end. It is authored exactly as a published npm
package would be — ships ESM + `.d.ts`, depends on
[`@anokye-labs/kbexplorer-core`](https://github.com/anokye-labs/kbexplorer-core)
as a *peer*, and adds graph nodes with **no change to the kbexplorer engine**.

In this repo it is vendored under `examples/` and wired in as a local
`file:` devDependency so the bare-specifier load path is genuinely exercised by a
test; a real provider would simply be `npm install`ed from a registry.

## The contract

A loadable provider module must:

1. **default-export a factory** wrapped in `defineProvider()` from core. The host
   dynamic-imports the module and calls `module.default(config)`.
2. **declare compatibility metadata** so the host can guard it *before*
   instantiation (see [`checkProviderCompatibility`](https://github.com/anokye-labs/kbexplorer-core)):
   - `export const apiVersion` — the provider-contract semver it targets
     (use the `PROVIDER_API_VERSION` re-exported by core).
   - `export const capabilities` — the host capabilities it requires
     (`'graph:nodes'`, `'graph:edges'`, …). A host that can't satisfy one skips
     the provider with a clear message rather than crashing.

```js
import { defineProvider, PROVIDER_API_VERSION } from '@anokye-labs/kbexplorer-core';

export const apiVersion = PROVIDER_API_VERSION;
export const capabilities = ['graph:nodes'];

export default defineProvider((config) => ({
  id: `quotes-${config.name ?? 'default'}`,
  name: config.name ?? 'Quotes',
  async resolve() {
    return { nodes: [/* … */], edges: [] };
  },
}));
```

## Usage

Reference it from `config.yaml` by its **bare package specifier**:

```yaml
providers:
  - type: quotes                              # advisory when `module` is set
    name: Quotes
    cluster: reference
    module: '@anokye-labs/kbexplorer-example-quotes'
    options:
      quotes:
        - id: kay
          text: The best way to predict the future is to invent it.
          author: Alan Kay
          connections: [graph-engine]
```

Each quote becomes a node titled by its author, with a `Quoted in` edge to every
id listed in `connections`.
