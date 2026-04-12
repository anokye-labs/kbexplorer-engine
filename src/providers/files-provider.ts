/**
 * Files Provider — wraps treeToNodes() into a GraphProvider.
 * Produces file-tree nodes (repo root, directories, key source files).
 * Edges are implicit via `contains` connections on each node.
 */
import type { GraphProvider, ProviderResult } from '../providers';
import type { KBConfig, KBNode } from '../../types';
import type { GHTreeItem } from '../../api';
import { treeToNodes } from '../parser';
import { assignIdentity } from '../identity';

export class FilesProvider implements GraphProvider {
  id = 'files';
  name = 'File System';
  dependencies: string[] = [];

  constructor(
    private treeItems: GHTreeItem[],
    private repoName: string,
    private excludePaths?: string[],
  ) {}

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    const nodes = treeToNodes(this.treeItems, this.repoName, this.excludePaths);

    for (const node of nodes) {
      node.provider = 'files';
      if (!node.identity) {
        node.identity = assignIdentity(node);
      }
    }

    return { nodes, edges: [] };
  }
}
