/**
 * Ordered post-provider transform stage (Phase 3 / F3 #313).
 *
 * The local and remote loaders previously each carried an identical ~90-line
 * block of post-processing run after the providers resolved their nodes:
 * synthesizing the README node, auto-linking issues to directories, and
 * splitting multi-heading issues into section nodes. That duplication was the
 * biggest coupling smell and the main blocker to a single load entrypoint.
 *
 * Here those steps become discrete, ordered {@link GraphTransform}s that the
 * orchestrator runs after collecting provider nodes. Each transform recomputes
 * the node subsets it needs from the current node list, so the stage is
 * order-stable and produces byte-identical output to the old inline blocks.
 *
 * Loaders now only build a {@link TransformContext} (the README text fetched
 * from the source) and hand it to the orchestrator — they contain no
 * post-processing logic themselves.
 */
import { marked } from 'marked';
import type { KBNode } from '../types';
import { extractIssueRefs, splitIntoSections } from './parser';

/**
 * Source-agnostic input the transform stage needs beyond the provider nodes.
 * The README arrives as raw markdown (or null when the source has none); every
 * other input is derived from the node list itself.
 */
export interface TransformContext {
  /** Raw README markdown for the source, or null when absent. */
  readme: string | null;
}

/**
 * A single ordered post-provider transform. `apply` receives the current node
 * list and returns the next one — it may mutate nodes in place (e.g. add
 * connections), append nodes, or replace nodes (e.g. split). Transforms must be
 * pure with respect to ordering: they recompute any subsets they need.
 */
export interface GraphTransform {
  readonly name: string;
  apply(nodes: KBNode[], ctx: TransformContext): KBNode[];
}

/** Issue nodes carry a `source.type === 'issue'`. */
function selectIssueNodes(nodes: KBNode[]): KBNode[] {
  return nodes.filter(n => n.source.type === 'issue');
}

/** Directory nodes are emitted by the files provider. */
function selectDirNodes(nodes: KBNode[]): KBNode[] {
  return nodes.filter(n => n.provider === 'files');
}

/**
 * Synthesize the README node and cross-reference it to issues + directories it
 * mentions (by issue ref, fuzzy title match, directory name, and inline links).
 * No-op when the source has no README.
 */
export const readmeTransform: GraphTransform = {
  name: 'readme',
  apply(nodes, ctx) {
    if (!ctx.readme) return nodes;

    const readme = ctx.readme;
    const issueNodes = selectIssueNodes(nodes);
    const dirNodes = selectDirNodes(nodes);
    const readmeConns: Array<{ to: string; description: string }> = [];
    const lower = readme.toLowerCase();

    const issueRefs = extractIssueRefs(readme);
    for (const num of issueRefs) {
      const id = `issue-${num}`;
      if (issueNodes.some(n => n.id === id)) {
        readmeConns.push({ to: id, description: `References #${num}` });
      }
    }
    for (const node of issueNodes) {
      if (readmeConns.some(c => c.to === node.id)) continue;
      const titleWords = node.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (titleWords.length === 0) continue;
      const matchCount = titleWords.filter(w => lower.includes(w)).length;
      if (matchCount >= Math.ceil(titleWords.length * 0.6)) {
        readmeConns.push({ to: node.id, description: 'Mentions' });
      }
    }
    for (const dir of dirNodes) {
      const dirName = dir.title.replace(/\/$/, '');
      if (lower.includes(`${dirName}/`) || lower.includes(`\`${dirName}\``)) {
        readmeConns.push({ to: dir.id, description: `References ${dirName}/` });
      }
    }
    readmeConns.push({ to: 'repo-root', description: 'Documents' });

    // Extract inline markdown links from README body: [text](target)
    const readmeConnectedTo = new Set(readmeConns.map(c => c.to));
    for (const m of readme.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      const target = m[2].trim();
      if (target.startsWith('http') || target.startsWith('#') || target.startsWith('/')) continue;
      if (target.match(/\.(png|jpg|jpeg|gif|svg|webp|md)$/i)) continue;
      if (readmeConnectedTo.has(target)) continue;
      readmeConns.push({ to: target, description: m[1] });
      readmeConnectedTo.add(target);
    }

    const html = marked.parse(readme, { async: false }) as string;
    nodes.push({
      id: 'readme', title: 'README', cluster: 'docs',
      content: html, rawContent: readme, emoji: 'Document',
      parent: 'repo-root',
      identity: 'urn:content:readme',
      connections: readmeConns, source: { type: 'readme' },
    });
    return nodes;
  },
};

/**
 * Auto-link each issue to directories whose name it references in its body.
 * Runs before {@link issueSplitTransform} so links stay on the original nodes.
 */
export const issueDirectoryLinkTransform: GraphTransform = {
  name: 'issue-directory-link',
  apply(nodes) {
    const issueNodes = selectIssueNodes(nodes);
    const dirNodes = selectDirNodes(nodes);
    const dirNames = dirNodes.map(d => d.title.replace(/\/$/, ''));
    for (const node of issueNodes) {
      for (let i = 0; i < dirNames.length; i++) {
        const dir = dirNames[i];
        if (node.rawContent && (
          node.rawContent.includes(`${dir}/`) ||
          node.rawContent.includes(`\`${dir}\``) ||
          node.rawContent.toLowerCase().includes(dir.toLowerCase())
        )) {
          node.connections.push({ to: dirNodes[i].id, description: `References ${dir}/` });
        }
      }
    }
    return nodes;
  },
};

/**
 * Split issues with 2+ headings into a parent + section nodes, replacing the
 * original issue node with its expansion.
 */
export const issueSplitTransform: GraphTransform = {
  name: 'issue-split',
  apply(nodes) {
    const issueNodes = selectIssueNodes(nodes);
    const dirNodes = selectDirNodes(nodes);
    const expandedIssues: KBNode[] = [];
    for (const node of issueNodes) {
      const sectionNodes = splitIntoSections(
        node.id, node.title, node.rawContent, node.cluster, node.emoji ?? 'Pin',
        node.source, [...issueNodes, ...dirNodes],
      );
      if (sectionNodes.length > 0) {
        const idx = nodes.indexOf(node);
        if (idx >= 0) nodes.splice(idx, 1);
        expandedIssues.push(...sectionNodes);
      }
    }
    nodes.push(...expandedIssues);
    return nodes;
  },
};

/**
 * Default ordered post-provider transform stage. Order is significant: README
 * synthesis, then issue→directory linking (before splitting), then issue
 * splitting. Matches the original inline loader sequence exactly.
 */
export const DEFAULT_TRANSFORMS: readonly GraphTransform[] = [
  readmeTransform,
  issueDirectoryLinkTransform,
  issueSplitTransform,
];

/** Run an ordered list of transforms over the node list. */
export function applyTransforms(
  nodes: KBNode[],
  ctx: TransformContext,
  transforms: readonly GraphTransform[] = DEFAULT_TRANSFORMS,
): KBNode[] {
  let current = nodes;
  for (const transform of transforms) {
    current = transform.apply(current, ctx);
  }
  return current;
}
