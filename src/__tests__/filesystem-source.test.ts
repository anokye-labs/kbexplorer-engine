import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemSource } from '../sources/filesystem-source';
import { loadKnowledgeBase } from '../loader';
import { DEFAULT_CONFIG } from '../default-config';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kbe-fs-source-'));
  await mkdir(join(root, 'content'), { recursive: true });
  await mkdir(join(root, 'content-model'), { recursive: true });
  await mkdir(join(root, '.github'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'junk'), { recursive: true });

  await writeFile(
    join(root, 'content', 'alpha.md'),
    '---\nid: alpha\ntitle: Alpha\nconnections:\n  - to: beta\n    description: leads to beta\n---\n# Alpha\n\nBody.\n',
  );
  await writeFile(
    join(root, 'content', 'beta.md'),
    '---\nid: beta\ntitle: Beta\n---\n# Beta\n\nBody.\n',
  );
  await writeFile(join(root, 'README.md'), '# The Readme\n');
  await writeFile(join(root, 'content-model', 'schema.yaml'), 'kind: schema\n');
  await writeFile(join(root, '.github', 'CODEOWNERS'), '* @owner\n');
  await writeFile(join(root, 'node_modules', 'junk', 'ignore.md'), 'should be ignored');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FileSystemSource', () => {
  it('is a read-only RepoSource', () => {
    const source = new FileSystemSource(root);
    expect(source.id).toBe('filesystem');
    expect(source.possibleAffordances).toEqual(['read']);
    expect(typeof source.getRepoData).toBe('function');
  });

  it('produces a normalized RepoData bundle mirroring ManifestSource', async () => {
    const source = new FileSystemSource(root, { repo: 'acme/demo' });
    const data = await source.getRepoData();

    expect(data.repo).toBe('acme/demo');
    // authored markdown under content/
    expect(Object.keys(data.authoredContent).sort()).toEqual(['content/alpha.md', 'content/beta.md']);
    // README captured
    expect(data.readme).toBe('# The Readme\n');
    // structural files captured (.github + CODEOWNERS)
    expect(data.structuralFiles['.github/CODEOWNERS']).toContain('@owner');
    // content-model captured, keyed relative to its root
    expect(data.contentModel?.root).toBe('content-model');
    expect(data.contentModel?.files['schema.yaml']).toBe('kind: schema\n');
    // GitHub-only families are empty (safe no-ops)
    expect(data.issues).toEqual([]);
    expect(data.pullRequests).toEqual([]);
    expect(data.commits).toEqual([]);
    expect(data.nodemapRaw).toBeNull();
  });

  it('walks recursively but skips node_modules/.git/dist', async () => {
    const source = new FileSystemSource(root);
    const data = await source.getRepoData();
    const paths = data.tree.map(t => t.path);
    expect(paths).toContain('content/alpha.md');
    expect(paths.some(p => p.includes('node_modules'))).toBe(false);
  });

  it('supports glob listing via listFiles', async () => {
    const source = new FileSystemSource(root);
    const data = await source.getRepoData();
    const md = await data.listFiles('content/*.md');
    expect(md.sort()).toEqual(['content/alpha.md', 'content/beta.md']);
  });

  it('exposes read-only file/tree resources', async () => {
    const source = new FileSystemSource(root, { repo: 'acme/demo' });
    const files = await source.retrieve({ kind: 'file' });
    expect(files.length).toBeGreaterThan(0);
    for (const resource of files) {
      expect(resource.affordances).toEqual(['read']);
      expect(resource.href.startsWith('file://acme/demo/')).toBe(true);
    }
    const trees = await source.retrieve({ kind: 'tree' });
    expect(trees.every(t => t.kind === 'tree')).toBe(true);
  });

  it('drives the config-first loadKnowledgeBase into a real graph', async () => {
    const source = new FileSystemSource(root, { repo: 'acme/demo' });
    const config = { ...DEFAULT_CONFIG, source: { owner: 'acme', repo: 'demo', path: 'content', branch: 'main' } };

    const graph = await loadKnowledgeBase(config, { source });

    const ids = graph.nodes.map(n => n.id);
    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');
    // the frontmatter connection alpha → beta became an edge
    expect(graph.edges.some(e => e.from === 'alpha' && e.to === 'beta')).toBe(true);
  });
});
