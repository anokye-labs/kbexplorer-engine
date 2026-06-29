import type { KBConfig } from '../types';

export const DEFAULT_STRUCTURED_CONTENT_PATH = 'content-model';

export interface StructuredContentConfig {
  path?: string;
}

type EnvLike = Record<string, string | boolean | undefined>;

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
  env: EnvLike = import.meta.env,
): string {
  const envValue = env.VITE_KB_STRUCTURED_CONTENT_PATH ?? env.VITE_KB_CONTENT_MODEL_PATH;
  const normalizedEnv = normalizeRepoRelativeDir(envValue);
  if (normalizedEnv) return normalizedEnv;

  const cfg = config as StructuredContentAwareConfig;
  const configured = cfg.structuredContent?.path ?? cfg.contentModel?.path;
  const normalizedConfig = normalizeRepoRelativeDir(configured);
  return normalizedConfig ?? DEFAULT_STRUCTURED_CONTENT_PATH;
}

export function hasExplicitStructuredContentPath(
  config: KBConfig,
  env: EnvLike = import.meta.env,
): boolean {
  const envValue = env.VITE_KB_STRUCTURED_CONTENT_PATH ?? env.VITE_KB_CONTENT_MODEL_PATH;
  if (normalizeRepoRelativeDir(envValue)) return true;

  const cfg = config as StructuredContentAwareConfig;
  const configured = cfg.structuredContent?.path ?? cfg.contentModel?.path;
  return normalizeRepoRelativeDir(configured) !== null;
}
