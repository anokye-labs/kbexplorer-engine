/**
 * Shared helper for the recipe scripts: loads the in-repo fixture knowledge
 * base from disk using the published engine build (`dist/`).
 *
 * Every recipe imports `loadFixtureGraph()` from here so the eight scripts stay
 * focused on the one API they demonstrate.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadKnowledgeBase, DEFAULT_CONFIG } from '../../dist/index.js';
import { FileSystemSource } from '../../dist/sources.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the fixture KB root directory. */
export const fixtureRoot = join(here, 'fixture');

/** Config pointing the loader at the fixture's `content/` directory. */
export const fixtureConfig = {
  ...DEFAULT_CONFIG,
  source: { owner: 'anokye-labs', repo: 'kbexplorer-engine-fixture', path: 'content', branch: 'main' },
};

/** Build a fresh {@link FileSystemSource} over the fixture. */
export function fixtureSource() {
  return new FileSystemSource(fixtureRoot, { repo: 'anokye-labs/kbexplorer-engine-fixture' });
}

/** Load the fixture into a bare KBGraph via the config-first loader form. */
export function loadFixtureGraph() {
  return loadKnowledgeBase(fixtureConfig, { source: fixtureSource() });
}
