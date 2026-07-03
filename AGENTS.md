# Agents — kbexplorer-engine

`@anokye-labs/kbexplorer-engine` is a new package in the kbexplorer stack.
Keep it runtime-agnostic by construction: the root engine surface should remain
portable across Node and browser-like environments unless a later store task adds
an explicit runtime shim.

## Stack

TypeScript, built with `tsup` (ESM + CJS + `.d.ts`), tested with `vitest`.

## Build / Test

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Compatibility

- Target Node `>=20`.
- Keep browser/DOM access out of the core engine surface.
- Preserve the package's public entry points (`.`, `./sources`, `./store`).
