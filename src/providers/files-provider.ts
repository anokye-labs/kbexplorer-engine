/**
 * Files Provider — wraps treeToNodes() into a GraphProvider.
 * Produces file-tree nodes (repo root, directories, key source files).
 * Edges are implicit via `contains` connections on each node.
 */
import type { GraphProvider, ProviderResult } from '../providers';
import type { KBConfig, KBNode } from '@anokye-labs/kbexplorer-core';
import type { GHTreeItem } from '../github-types';
import { treeToNodes } from '../parser';
import { assignIdentity } from '../identity';

export class FilesProvider implements GraphProvider {
  id = 'files';
  name = 'File System';
  dependencies: string[] = [];

  private treeItems: GHTreeItem[];
  private repoName: string;
  private excludePaths?: string[] | undefined;

  constructor(
    treeItems: GHTreeItem[],
    repoName: string,
    excludePaths?: string[],
  ) {
    this.treeItems = treeItems;
    this.repoName = repoName;
    this.excludePaths = excludePaths;
  }

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    const nodes = treeToNodes(this.treeItems, this.repoName, this.excludePaths);

    for (const node of nodes) {
      node.provider = 'files';
      if (!node.identity) {
        const identity = assignIdentity(node);
        if (identity !== undefined) node.identity = identity;
      }
    }

    return { nodes, edges: [] };
  }
}
