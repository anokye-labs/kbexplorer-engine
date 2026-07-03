# @anokye-labs/kbexplorer-engine

This repository is the initial scaffold for `@anokye-labs/kbexplorer-engine`.
It is intentionally empty-but-building: the package ships placeholder exports for
its root, source, and store entry points so consumers can import it while the real
engine modules are migrated in follow-up work.

## Develop

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Package shape

- `.` exports the placeholder engine entry point surface.
- `./sources` exports placeholder source classes and types.
- `./store` exports a placeholder sqlite-backed store entry point.
