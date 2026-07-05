/**
 * Recipe 06 — Extract a neighborhood subgraph with subgraph().
 */
import { subgraph } from '../../dist/index.js';
import { loadFixtureGraph } from './_load-fixture.mjs';

const graph = await loadFixtureGraph();

const radius1 = subgraph(graph, 'home', { radius: 1 });
console.log('radius 1 from home:', radius1.nodes.map(n => n.id).sort().join(', '));

const radius2 = subgraph(graph, 'home', { radius: 2 });
console.log('radius 2 from home:', radius2.nodes.map(n => n.id).sort().join(', '));
console.log('radius 2 edges:', radius2.edges.length);
console.log('radius 2 clusters:', radius2.clusters.map(c => c.id).sort().join(', '));
