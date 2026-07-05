/**
 * Recipe 05 — Read the precomputed related index with related().
 */
import { related } from '../../dist/index.js';
import { loadFixtureGraph } from './_load-fixture.mjs';

const graph = await loadFixtureGraph();

for (const id of ['home', 'query-api']) {
  const relatedIds = related(graph, id).map(n => n.id).sort();
  console.log(`related to ${id}:`, relatedIds.join(', ') || '(none)');
}
