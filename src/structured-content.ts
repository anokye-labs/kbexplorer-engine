import type { KBConfig } from '@anokye-labs/kbexplorer-core';
import type { EngineEnv } from './env';

export const DEFAULT_STRUCTURED_CONTENT_PATH = 'content-model';

export interface StructuredContentConfig {
  path?: string;
}

type EnvLike = EngineEnv;

type StructuredContentAwareConfig = KBConfig & {
  structuredContent?: StructuredContentConfig;
  contentModel?: StructuredContentConfig;
};

export function normalizeRepoRelativeDir(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim().replace(/\\/g, '/');
  while (value.startsWith('./')) value = value.slice(2);
  value = value.replace(/\/+$/g, '');
  if (
    !value ||
    /^[a-zA-Z]:\//.test(value) ||
    value.startsWith('/') ||
    value.includes('://') ||
    value === '..' ||
    value.startsWith('../') ||
    value.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    return null;
  }
  return value;
}

export function resolveStructuredContentPath(
  config: KBConfig,
  env?: EnvLike,
): string {
  const engineEnv = env ?? {};
  const envValue = engineEnv.VITE_KB_STRUCTURED_CONTENT_PATH ?? engineEnv.VITE_KB_CONTENT_MODEL_PATH;
  const normalizedEnv = normalizeRepoRelativeDir(envValue);
  if (normalizedEnv) return normalizedEnv;

  const cfg = config as StructuredContentAwareConfig;
  const configured = cfg.structuredContent?.path ?? cfg.contentModel?.path;
  const normalizedConfig = normalizeRepoRelativeDir(configured);
  return normalizedConfig ?? DEFAULT_STRUCTURED_CONTENT_PATH;
}

export function hasExplicitStructuredContentPath(
  config: KBConfig,
  env?: EnvLike,
): boolean {
  const engineEnv = env ?? {};
  const envValue = engineEnv.VITE_KB_STRUCTURED_CONTENT_PATH ?? engineEnv.VITE_KB_CONTENT_MODEL_PATH;
  if (normalizeRepoRelativeDir(envValue)) return true;

  const cfg = config as StructuredContentAwareConfig;
  const configured = cfg.structuredContent?.path ?? cfg.contentModel?.path;
  return normalizeRepoRelativeDir(configured) !== null;
}
