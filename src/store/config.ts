import type { EngineEnv } from '../env';

export type GraphStoreMode = 'off' | 'sqlite';

export interface GraphStoreOptions {
  mode: GraphStoreMode;
}

export function resolveGraphStoreOptions(
  env?: EngineEnv,
): GraphStoreOptions {
  const engineEnv = env ?? {};
  const raw = engineEnv.VITE_KB_GRAPH_STORE;
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value || value === 'off' || value === 'false' || value === '0') {
    return { mode: 'off' };
  }
  if (value === 'sqlite') return { mode: 'sqlite' };
  throw new Error(`Unsupported VITE_KB_GRAPH_STORE value: ${String(raw)}`);
}

export function isGraphStoreEnabled(
  env?: EngineEnv,
): boolean {
  return resolveGraphStoreOptions(env).mode === 'sqlite';
}
