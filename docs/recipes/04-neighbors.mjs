/**
 * Recipe 04 — Walk a node's direct neighbors with neighbors().
 *
 * Demonstrates direction ('out' | 'in' | 'both') and edge-type filtering.
 */
import { neighbors } from '../../dist/index.js';
import { loadFixtureGraph } from './_load-fixture.mjs';

const graph = await loadFixtureGraph();

const both = neighbors(graph, 'graph-engine').map(n => n.id).sort();
console.log('graph-engine (both):', both.join(', '));

const out = neighbors(graph, 'graph-engine', { direction: 'out' }).map(n => n.id).sort();
console.log('graph-engine (out):', out.join(', '));

const incoming = neighbors(graph, 'graph-engine', { direction: 'in' }).map(n => n.id).sort();
console.log('graph-engine (in):', incoming.join(', '));
