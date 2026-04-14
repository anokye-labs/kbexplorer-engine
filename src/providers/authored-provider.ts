/**
 * Authored Provider — wraps authored-content parsing (markdown files + nodemap)
 * into a GraphProvider so the engine can orchestrate it alongside other providers.
 */
import type { GraphProvider, ProviderResult } from '../providers';
import type { KBConfig, KBNode } from '../../types';
import { parseMarkdownFile } from '../parser';
import { loadNodeMap } from '../nodemap';
import { assignIdentity } from '../identity';

export class AuthoredProvider implements GraphProvider {
  id = 'authored';
  name = 'Authored Content';
  dependencies: string[] = [];

  constructor(
    private authoredContent: Record<string, string>,
    private nodemapRaw?: string | null,
    private nodemapFiles?: Record<string, string>,
    private nodemapDirs?: Record<string, Array<{ path: string; type: 'blob' | 'tree'; size?: number }>>,
    private listFiles?: (pattern: string) => Promise<string[]>,
  ) {}

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    const nodes: KBNode[] = [];

    // 1. Parse each authored content markdown file
    for (const [path, raw] of Object.entries(this.authoredContent)) {
      try {
        const node = parseMarkdownFile(path, raw);
        node.provider = 'authored';
        // parseMarkdownFile already sets identity via assignIdentity,
        // but ensure the urn:content: prefix is present
        if (!node.identity) {
          node.identity = `urn:content:${node.id}`;
        }
        nodes.push(node);
      } catch {
        console.warn(`[AuthoredProvider] Failed to parse ${path}, skipping`);
      }
    }

    // 2. Process nodemap entries if present
    if (this.nodemapRaw) {
      const readFile = async (path: string): Promise<string | null> =>
        this.nodemapFiles?.[path] ?? null;

      const listDirectory = this.nodemapDirs
        ? async (dir: string) => this.nodemapDirs![dir] ?? []
        : undefined;

      const nodemapNodes = await loadNodeMap(
        this.nodemapRaw,
        readFile,
        this.listFiles,
        listDirectory,
      );

      for (const node of nodemapNodes) {
        node.provider = 'authored';
        // For nodemap nodes with a file source, use urn:file: identity
        if (!node.identity) {
          node.identity = assignIdentity(node) ?? `urn:content:${node.id}`;
        }
        nodes.push(node);
      }
    }

    return { nodes, edges: [] };
  }
}
