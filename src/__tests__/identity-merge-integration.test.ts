/**
 * Integration test for the identity merge machinery (#445, spec item 6).
 *
 * Proves the end-to-end contract the pieces were built for: a nodemap.yaml
 * `file:` entry mints a content node whose identity is `urn:file:<path>` —
 * deliberately the SAME identity assignIdentity gives the file-tree node for
 * that path — so buildIdentityIndex/shareIdentity see one resource with two
 * representations, and filterGraphToLayer('content') merges them: the file
 * node disappears from the content layer and its edges/related remap onto
 * the content node.
 */
import { describe, it, expect } from 'vitest';
import { loadNodeMap } from '../nodemap';
import { assignIdentity, buildIdentityIndex, shareIdentity } from '../identity';
import { buildGraph } from '../graph';
import { filterGraphToLayer, getNodeLayer } from '../../representation/graph-layers';
import type { KBNode, Cluster } from '../../types';

const CLUSTERS: Cluster[] = [
  { id: 'docs', name: 'Docs', color: '#888888' },
  { id: 'default', name: 'Default', color: '#cccccc' },
];

const GUIDE_PATH = 'docs/guide.md';

/** The file-tree representation of docs/guide.md (as treeToNodes would mint). */
function makeFileNode(): KBNode {
  const node: KBNode = {
    id: `file-${GUIDE_PATH}`,
    title: 'guide.md',
    cluster: 'default',
    content: '',
    rawContent: '',
    connections: [],
    source: { type: 'file', path: GUIDE_PATH },
  };
  node.identity = assignIdentity(node);
  return node;
}

/** An authored doc that links to the file-tree node (edge under test). */
function makeAuthoredNode(): KBNode {
  const node: KBNode = {
    id: 'handbook',
    title: 'Handbook',
    cluster: 'docs',
    content: '<p>handbook</p>',
    rawContent: 'handbook',
    connections: [
      { to: `file-${GUIDE_PATH}`, description: 'covers the guide' },
    ],
    source: { type: 'authored', file: 'content/handbook.md' },
  };
  node.identity = assignIdentity(node);
  return node;
}

async function loadGuideFromNodeMap(): Promise<KBNode> {
  const nodemapYaml = [
    'nodes:',
    '  - id: guide',
    `    file: ${GUIDE_PATH}`,
    '    cluster: docs',
  ].join('\n');
  const readFile = async (path: string) =>
    path === GUIDE_PATH ? '# Guide\n\nHow things work.' : null;
  const nodes = await loadNodeMap(nodemapYaml, readFile);
  expect(nodes).toHaveLength(1);
  return nodes[0];
}

describe('identity merge machinery — nodemap file: link merges file + content node', () => {
  it('nodemap file: entry mints the file-tree identity, so the two representations share it', async () => {
    const contentNode = await loadGuideFromNodeMap();
    const fileNode = makeFileNode();
    buildGraph([contentNode], CLUSTERS);

    // The deliberate handshake: both representations carry urn:file:<path>.
    expect(contentNode.identity).toBe(`urn:file:${GUIDE_PATH}`);
    expect(fileNode.identity).toBe(`urn:file:${GUIDE_PATH}`);
    expect(shareIdentity(fileNode, contentNode)).toBe(true);

    // ...and they sit on different layers pre-merge.
    expect(getNodeLayer(contentNode)).toBe('content');
    expect(getNodeLayer(fileNode)).toBe('file');

    // buildIdentityIndex groups both node ids under the one identity.
    const index = buildIdentityIndex([contentNode, fileNode, makeAuthoredNode()]);
    expect(index.get(`urn:file:${GUIDE_PATH}`)?.sort()).toEqual(
      ['guide', `file-${GUIDE_PATH}`].sort(),
    );
  });

  it("filterGraphToLayer('content') merges the file node into its content counterpart", async () => {
    const contentNode = await loadGuideFromNodeMap();
    const fileNode = makeFileNode();
    const authored = makeAuthoredNode();

    const graph = buildGraph([authored, contentNode, fileNode], CLUSTERS);
    // Pre-merge sanity: the full graph carries both representations and the
    // authored edge targets the FILE node.
    expect(graph.nodes.map(n => n.id).sort()).toEqual(
      ['handbook', 'guide', `file-${GUIDE_PATH}`].sort(),
    );
    expect(
      graph.edges.some(e => e.from === 'handbook' && e.to === `file-${GUIDE_PATH}`),
    ).toBe(true);

    const content = filterGraphToLayer(graph, 'content');

    // The file node is merged away; the content node represents the resource.
    const ids = content.nodes.map(n => n.id);
    expect(ids).toContain('guide');
    expect(ids).toContain('handbook');
    expect(ids).not.toContain(`file-${GUIDE_PATH}`);

    // The authored edge is REMAPPED onto the content node (not dropped).
    expect(content.edges.some(e => e.from === 'handbook' && e.to === 'guide')).toBe(true);
    expect(content.edges.some(e => e.to === `file-${GUIDE_PATH}`)).toBe(false);

    // Related references follow the remap too — no dangling file-node ids.
    for (const rel of Object.values(content.related)) {
      expect(rel).not.toContain(`file-${GUIDE_PATH}`);
    }
  });

  it('a file node WITHOUT a nodemap counterpart is not merged away by identity', async () => {
    const fileNode = makeFileNode();
    const authored = makeAuthoredNode();
    const graph = buildGraph([authored, fileNode], CLUSTERS);

    const content = filterGraphToLayer(graph, 'content');
    // No content node shares urn:file:<path>, so the referenced file node
    // stays visible in the content layer (referenced-file passthrough).
    expect(content.nodes.map(n => n.id)).toContain(`file-${GUIDE_PATH}`);
  });
});
