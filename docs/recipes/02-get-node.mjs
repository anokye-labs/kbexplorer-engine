/**
 * Recipe 02 — Look up a single node by id with getNode.
 */
import { getNode } from '../../dist/index.js';
import { loadFixtureGraph } from './_load-fixture.mjs';

const graph = await loadFixtureGraph();

const home = getNode(graph, 'home');
console.log('found:', home?.id, '-', home?.title);
console.log('cluster:', home?.cluster);
console.log('missing:', getNode(graph, 'does-not-exist'));
