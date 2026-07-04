import { describe, it, expect } from 'vitest';
import { FilesProvider } from '../../providers/files-provider';
import type { GHTreeItem } from '../../../api';
import type { KBConfig } from '../../../types';
import { DEFAULT_CONFIG } from '../../../types';

function makeTreeItem(path: string, type: 'blob' | 'tree' = 'blob'): GHTreeItem {
  return { path, mode: '100644', type, sha: 'abc123', size: 100, url: '' };
}

const config: KBConfig = DEFAULT_CONFIG;

describe('FilesProvider', () => {
  it('produces nodes from tree items', async () => {
    const items: GHTreeItem[] = [
      makeTreeItem('src/main.ts'),
      makeTreeItem('src', 'tree'),
    ];
    const provider = new FilesProvider(items, 'my-repo');
    const { nodes } = await provider.resolve(config, []);

    // treeToNodes always creates a repo-root; directory + file nodes depend on extensions
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.some(n => n.id === 'repo-root')).toBe(true);
  });

  it('tags each node with provider: files', async () => {
    const items: GHTreeItem[] = [
      makeTreeItem('src/index.ts'),
    ];
    const provider = new FilesProvider(items, 'my-repo');
    const { nodes } = await provider.resolve(config, []);

    for (const node of nodes) {
      expect(node.provider).toBe('files');
    }
  });

  it('assigns identity URNs to file nodes', async () => {
    const items: GHTreeItem[] = [
      makeTreeItem('src/app.ts'),
    ];
    const provider = new FilesProvider(items, 'my-repo');
    const { nodes } = await provider.resolve(config, []);

    const root = nodes.find(n => n.id === 'repo-root');
    expect(root?.identity).toBe('urn:file:/');
  });

  it('returns empty edges array', async () => {
    const items: GHTreeItem[] = [
      makeTreeItem('src/utils.ts'),
    ];
    const provider = new FilesProvider(items, 'my-repo');
    const { edges } = await provider.resolve(config, []);

    expect(edges).toEqual([]);
  });

  it('handles empty tree', async () => {
    const provider = new FilesProvider([], 'my-repo');
    const { nodes, edges } = await provider.resolve(config, []);

    // Even with empty tree, treeToNodes creates a repo-root
    expect(nodes.some(n => n.id === 'repo-root')).toBe(true);
    expect(edges).toEqual([]);
  });

  it('excludes paths when configured', async () => {
    const items: GHTreeItem[] = [
      makeTreeItem('content/intro.md'),
      makeTreeItem('src/main.ts'),
    ];
    const provider = new FilesProvider(items, 'my-repo', ['content']);
    const { nodes } = await provider.resolve(config, []);

    // No node should reference content/ directory files
    const contentNodes = nodes.filter(
      n => n.source.type === 'file' && (n.source as { path: string }).path.startsWith('content'),
    );
    expect(contentNodes).toHaveLength(0);
  });
});
