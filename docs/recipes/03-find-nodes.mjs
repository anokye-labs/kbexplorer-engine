/**
 * Recipe 03 — Find nodes matching a predicate with findNodes.
 */
import { findNodes } from '../../dist/index.js';
import { loadFixtureGraph } from './_load-fixture.mjs';

const graph = await loadFixtureGraph();

const engineNodes = findNodes(graph, n => n.cluster === 'engine');
console.log('engine nodes:', engineNodes.map(n => n.id).sort().join(', '));

const titled = findNodes(graph, n => n.title.includes('Graph'));
console.log('titles containing "Graph":', titled.map(n => n.title).join(', '));
