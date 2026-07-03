import { describe, expect, it } from 'vitest';
import type { KBConfig } from '@anokye-labs/kbexplorer-core';
import {
  DEFAULT_STRUCTURED_CONTENT_PATH,
  hasExplicitStructuredContentPath,
  normalizeRepoRelativeDir,
  resolveStructuredContentPath,
} from '../structured-content';

const config = {} as KBConfig;

describe('structured content config', () => {
  it('preserves content-model as the default path', () => {
    expect(resolveStructuredContentPath(config, {})).toBe(DEFAULT_STRUCTURED_CONTENT_PATH);
  });

  it('reads the preferred structuredContent.path config field', () => {
    const configured = {
      structuredContent: { path: 'docs/team-model/' },
    } as KBConfig & { structuredContent: { path: string } };

    expect(resolveStructuredContentPath(configured, {})).toBe('docs/team-model');
  });

  it('lets env override config for build/runtime parity', () => {
    const configured = {
      structuredContent: { path: 'docs/team-model' },
    } as KBConfig & { structuredContent: { path: string } };

    expect(resolveStructuredContentPath(configured, {
      VITE_KB_STRUCTURED_CONTENT_PATH: 'ops/model',
    })).toBe('ops/model');
  });

  it('supports the legacy content-model env override alias', () => {
    expect(resolveStructuredContentPath(config, {
      VITE_KB_CONTENT_MODEL_PATH: 'legacy/model',
    })).toBe('legacy/model');
  });

  it('detects when a structured-content path was explicitly configured', () => {
    const configured = {
      structuredContent: { path: 'docs/team-model' },
    } as KBConfig & { structuredContent: { path: string } };

    expect(hasExplicitStructuredContentPath(configured, {})).toBe(true);
    expect(hasExplicitStructuredContentPath(config, {
      VITE_KB_CONTENT_MODEL_PATH: 'legacy/model',
    })).toBe(true);
    expect(hasExplicitStructuredContentPath(config, {})).toBe(false);
  });

  it('normalizes Windows separators and rejects unsafe paths', () => {
    expect(normalizeRepoRelativeDir('ops\\model\\')).toBe('ops/model');
    expect(normalizeRepoRelativeDir('C:\\tmp\\model')).toBeNull();
    expect(normalizeRepoRelativeDir('../secrets')).toBeNull();
    expect(normalizeRepoRelativeDir('/tmp/model')).toBeNull();
    expect(normalizeRepoRelativeDir('https://example.com/model')).toBeNull();
  });
});
