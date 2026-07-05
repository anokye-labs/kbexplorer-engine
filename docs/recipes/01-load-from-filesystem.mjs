/**
 * Recipe 01 — Load a knowledge base from the filesystem.
 *
 * Uses the Node-only FileSystemSource with the config-first loadKnowledgeBase
 * form, which returns a bare KBGraph.
 */
import { loadFixtureGraph } from './_load-fixture.mjs';

const graph = await loadFixtureGraph();

const ids = graph.nodes.map(n => n.id).sort();
console.log('nodes:', graph.nodes.length);
console.log('ids:', ids.join(', '));
console.log('edges:', graph.edges.length);
console.log('clusters:', graph.clusters.map(c => c.id).sort().join(', '));
