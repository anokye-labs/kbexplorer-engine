/**
 * Recipe 07 — Find the shortest path between two nodes with shortestPath().
 */
import { shortestPath } from '../../dist/index.js';
import { loadFixtureGraph } from './_load-fixture.mjs';

const graph = await loadFixtureGraph();

console.log('home -> loader:', shortestPath(graph, 'home', 'loader')?.join(' -> '));
console.log('home -> home:', shortestPath(graph, 'home', 'home')?.join(' -> '));
console.log('home -> ghost:', shortestPath(graph, 'home', 'ghost'));
