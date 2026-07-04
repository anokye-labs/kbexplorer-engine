/**
 * Authored Provider — wraps authored-content parsing (markdown files + nodemap)
 * into a GraphProvider so the engine can orchestrate it alongside other providers.
 */
import type { GraphProvider, ProviderResult } from '../providers';
import type { KBConfig, KBNode } from '@anokye-labs/kbexplorer-core';
import { parseMarkdownFile } from '../parser';
import { loadNodeMap } from '../nodemap';
import { assignIdentity } from '../identity';
import { isRichAuthoredMarkdown } from './rich-markdown/detect';

export class AuthoredProvider implements GraphProvider {
  id = 'authored';
  name = 'Authored Content';
  dependencies: string[] = [];

  private authoredContent: Record<string, string>;
  private nodemapRaw?: string | null | undefined;
  private nodemapFiles?: Record<string, string> | undefined;
  private nodemapDirs?: Record<string, Array<{ path: string; type: 'blob' | 'tree'; size?: number }>> | undefined;
  private listFiles?: ((pattern: string) => Promise<string[]>) | undefined;

  constructor(
    authoredContent: Record<string, string>,
    nodemapRaw?: string | null,
    nodemapFiles?: Record<string, string>,
    nodemapDirs?: Record<string, Array<{ path: string; type: 'blob' | 'tree'; size?: number }>>,
    listFiles?: (pattern: string) => Promise<string[]>,
  ) {
    this.authoredContent = authoredContent;
    this.nodemapRaw = nodemapRaw;
    this.nodemapFiles = nodemapFiles;
    this.nodemapDirs = nodemapDirs;
    this.listFiles = listFiles;
  }

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    const nodes: KBNode[] = [];

    // 1. Parse each authored content markdown file
    for (const [path, raw] of Object.entries(this.authoredContent)) {
      // Docs opting into rich-Markdown (`display: rich-markdown`) are owned by
      // AuthoredRichMarkdownProvider; skip them here so a doc is never emitted
      // twice (this provider keeps the plain prose / `urn:content:` path).
      if (isRichAuthoredMarkdown(raw)) continue;
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
