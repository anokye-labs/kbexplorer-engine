/**
 * Identity URN helpers — canonical identifiers that link node
 * representations across providers and layers.
 */
import type { KBNode } from '../types';

/** Generate a canonical identity URN for a node based on its source. */
export function assignIdentity(node: KBNode): string | undefined {
  switch (node.source.type) {
    case 'file':       return `urn:file:${node.source.path}`;
    case 'authored':   return `urn:content:${node.id}`;
    case 'readme':     return 'urn:content:readme';
    case 'issue':      return `urn:issue:${node.source.number}`;
    case 'pull_request': return `urn:pr:${node.source.number}`;
    case 'commit':     return `urn:commit:${node.source.sha}`;
    case 'section':    return undefined;
    default:           return undefined;
  }
}

/** Check if two nodes share an identity. */
export function shareIdentity(a: KBNode, b: KBNode): boolean {
  return !!(a.identity && b.identity && a.identity === b.identity);
}

/**
 * Build an identity index — maps identity URNs to all node IDs that share them.
 * Used by the view system to merge representations.
 */
export function buildIdentityIndex(nodes: KBNode[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.identity) continue;
    const existing = index.get(n.identity) ?? [];
    existing.push(n.id);
    index.set(n.identity, existing);
  }
  return index;
}
