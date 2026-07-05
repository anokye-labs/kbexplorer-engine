/**
 * Recipe 08 — The positional (advanced) loadKnowledgeBase form.
 *
 * Passing a source first returns the `{ graph, config }` envelope — the exact
 * shape the kbexplorer-template pins by SHA. Contrast with the config-first
 * form (recipe 01), which returns a bare KBGraph.
 */
import { loadKnowledgeBase } from '../../dist/index.js';
import { fixtureConfig, fixtureSource } from './_load-fixture.mjs';

const result = await loadKnowledgeBase(fixtureSource(), fixtureConfig);

console.log('return keys:', Object.keys(result).sort().join(', '));
console.log('graph nodes:', result.graph.nodes.length);
console.log('config title:', result.config.title);
