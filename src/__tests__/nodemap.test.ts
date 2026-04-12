import { describe, it, expect, vi } from 'vitest';
import { loadNodeMap, resolveImportPath, extractImportPaths } from '../nodemap';

// ── Mock callbacks ─────────────────────────────────────────

type ReadFile = (path: string) => Promise<string | null>;
type ListFiles = (pattern: string) => Promise<string[]>;
type ListDirectory = (dir: string) => Promise<{ path: string; type: 'blob' | 'tree'; size?: number }[]>;

function mockReadFile(files: Record<string, string>): ReadFile {
  return async (path: string) => files[path] ?? null;
}

function mockListFiles(paths: string[]): ListFiles {
  return async () => paths;
}

function mockListDirectory(
  items: { path: string; type: 'blob' | 'tree'; size?: number }[],
): ListDirectory {
  return async () => items;
}

// ── YAML helpers ───────────────────────────────────────────

function yamlNodes(entries: string): string {
  return `nodes:\n${entries}`;
}

// ── Single-file mode ───────────────────────────────────────

describe('loadNodeMap — single file', () => {
  it('produces 1 node with display "code" for a .ts file', async () => {
    const yml = yamlNodes(`  - id: main
    file: src/main.ts`);
    const read = mockReadFile({ 'src/main.ts': 'console.log("hi");' });
    const nodes = await loadNodeMap(yml, read);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('main');
    expect(nodes[0].display).toBe('code');
    expect(nodes[0].source).toEqual({ type: 'file', path: 'src/main.ts' });
  });

  it('produces 1 node with authored source for a .md file', async () => {
    const yml = yamlNodes(`  - id: guide
    file: docs/guide.md`);
    const read = mockReadFile({ 'docs/guide.md': '# Guide\n\nSome text.' });
    const nodes = await loadNodeMap(yml, read);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('guide');
    expect(nodes[0].source).toEqual({ type: 'authored', file: 'docs/guide.md' });
    expect(nodes[0].display).toBeUndefined(); // markdown default, no explicit display
  });

  it('uses title from entry when provided', async () => {
    const yml = yamlNodes(`  - id: cfg
    file: config.ts
    title: Configuration`);
    const read = mockReadFile({ 'config.ts': 'export default {};' });
    const nodes = await loadNodeMap(yml, read);

    expect(nodes[0].title).toBe('Configuration');
  });

  it('falls back to basename for title when not provided', async () => {
    const yml = yamlNodes(`  - id: cfg
    file: src/config.ts`);
    const read = mockReadFile({ 'src/config.ts': 'export default {};' });
    const nodes = await loadNodeMap(yml, read);

    expect(nodes[0].title).toBe('config');
  });

  it('assigns cluster from entry', async () => {
    const yml = yamlNodes(`  - id: api
    file: api.ts
    cluster: backend`);
    const read = mockReadFile({ 'api.ts': '' });
    const nodes = await loadNodeMap(yml, read);

    expect(nodes[0].cluster).toBe('backend');
  });
});

// ── Split mode ─────────────────────────────────────────────

describe('loadNodeMap — split headings', () => {
  it('produces parent + section nodes for file with 2+ ## headings', async () => {
    const md = `# Big Doc\n\nIntro.\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.`;
    const yml = yamlNodes(`  - id: big
    file: big.md
    split: headings`);
    const read = mockReadFile({ 'big.md': md });
    const nodes = await loadNodeMap(yml, read);

    expect(nodes.length).toBeGreaterThanOrEqual(3); // parent + 2 sections
    const parent = nodes.find(n => n.nodeType === 'parent');
    expect(parent).toBeDefined();
    expect(parent!.id).toBe('big');
    const sections = nodes.filter(n => n.nodeType === 'section');
    expect(sections.length).toBe(2);
  });

  it('falls back to single node when fewer than 2 headings', async () => {
    const md = '# Only One\n\nJust one section.';
    const yml = yamlNodes(`  - id: small
    file: small.md
    split: headings`);
    const read = mockReadFile({ 'small.md': md });
    const nodes = await loadNodeMap(yml, read);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('small');
    expect(nodes[0].nodeType).toBeUndefined();
  });
});

// ── Merge mode ─────────────────────────────────────────────

describe('loadNodeMap — merge files', () => {
  it('produces 1 merged node from multiple files', async () => {
    const yml = yamlNodes(`  - id: merged
    files:
      - a.ts
      - b.ts`);
    const read = mockReadFile({ 'a.ts': 'const a = 1;', 'b.ts': 'const b = 2;' });
    const nodes = await loadNodeMap(yml, read);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('merged');
    expect(nodes[0].display).toBe('file-list');
    expect(nodes[0].rawContent).toContain('a.ts');
    expect(nodes[0].rawContent).toContain('b.ts');
  });

  it('returns empty when all merge files are missing', async () => {
    const yml = yamlNodes(`  - id: gone
    files:
      - missing1.ts
      - missing2.ts`);
    const read = mockReadFile({});
    const nodes = await loadNodeMap(yml, read);

    expect(nodes).toHaveLength(0);
  });
});

// ── Glob mode ──────────────────────────────────────────────

describe('loadNodeMap — glob', () => {
  it('produces N nodes matching the glob pattern', async () => {
    const yml = yamlNodes(`  - id: comps
    glob: "src/*.ts"
    each: file`);
    const read = mockReadFile({
      'src/alpha.ts': 'const a = 1;',
      'src/beta.ts': 'const b = 2;',
    });
    const list = mockListFiles(['src/alpha.ts', 'src/beta.ts']);
    const nodes = await loadNodeMap(yml, read, list);

    expect(nodes).toHaveLength(2);
    expect(nodes.map(n => n.id).sort()).toEqual(['comps-alpha', 'comps-beta']);
  });

  it('applies exclude patterns correctly', async () => {
    const yml = yamlNodes(`  - id: files
    glob: "src/*.ts"
    each: file
    exclude:
      - "src/secret.ts"`);
    const read = mockReadFile({
      'src/public.ts': 'export {};',
      'src/secret.ts': 'secret',
    });
    const list = mockListFiles(['src/public.ts', 'src/secret.ts']);
    const nodes = await loadNodeMap(yml, read, list);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('files-public');
  });

  it('titleFrom "filename" uses basename', async () => {
    const yml = yamlNodes(`  - id: docs
    glob: "docs/*.md"
    each: file
    titleFrom: filename`);
    const read = mockReadFile({ 'docs/setup.md': '# Setup Guide\n\nText.' });
    const list = mockListFiles(['docs/setup.md']);
    const nodes = await loadNodeMap(yml, read, list);

    expect(nodes[0].title).toBe('setup');
  });

  it('titleFrom "heading" reads first # heading', async () => {
    const yml = yamlNodes(`  - id: docs
    glob: "docs/*.md"
    each: file
    titleFrom: heading`);
    const read = mockReadFile({ 'docs/setup.md': '# Setup Guide\n\nText.' });
    const list = mockListFiles(['docs/setup.md']);
    const nodes = await loadNodeMap(yml, read, list);

    expect(nodes[0].title).toBe('Setup Guide');
  });

  it('returns empty when no listFiles callback provided', async () => {
    const yml = yamlNodes(`  - id: orphan
    glob: "src/*.ts"
    each: file`);
    const read = mockReadFile({});
    const nodes = await loadNodeMap(yml, read);

    expect(nodes).toHaveLength(0);
  });
});

// ── Directory mode ─────────────────────────────────────────

describe('loadNodeMap — directory', () => {
  it('produces 1 tree node from directory listing', async () => {
    const yml = yamlNodes(`  - id: src-tree
    directory: src/`);
    const dirItems = [
      { path: 'src/index.ts', type: 'blob' as const, size: 1024 },
      { path: 'src/utils', type: 'tree' as const },
    ];
    const read = mockReadFile({});
    const listDir = mockListDirectory(dirItems);
    const nodes = await loadNodeMap(yml, read, undefined, listDir);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('src-tree');
    expect(nodes[0].display).toBe('tree');
    expect(nodes[0].rawContent).toContain('📁');
    expect(nodes[0].rawContent).toContain('📄');
  });

  it('returns empty when no listDirectory callback provided', async () => {
    const yml = yamlNodes(`  - id: dir
    directory: lib/`);
    const read = mockReadFile({});
    const nodes = await loadNodeMap(yml, read);

    expect(nodes).toHaveLength(0);
  });
});

// ── Connection derivation ──────────────────────────────────

describe('loadNodeMap — connection derivation "imports"', () => {
  it('scans for import statements and creates edges', async () => {
    const yml = yamlNodes(`  - id: entry
    file: src/app.ts
    connections: imports
  - id: utils
    file: src/utils.ts`);
    const read = mockReadFile({
      'src/app.ts': "import { helper } from './utils';\nconsole.log(helper());",
      'src/utils.ts': 'export function helper() { return 42; }',
    });
    const nodes = await loadNodeMap(yml, read);

    const app = nodes.find(n => n.id === 'entry')!;
    expect(app.connections.some(c => c.to === 'utils' && c.type === 'references')).toBe(true);
  });
});

// ── Empty / missing files ──────────────────────────────────

describe('loadNodeMap — empty/missing files', () => {
  it('handles missing file gracefully', async () => {
    const yml = yamlNodes(`  - id: ghost
    file: nonexistent.ts`);
    const read = mockReadFile({});
    const nodes = await loadNodeMap(yml, read);

    expect(nodes).toHaveLength(0);
  });

  it('handles empty nodemap', async () => {
    const nodes = await loadNodeMap('nodes: []', async () => null);
    expect(nodes).toHaveLength(0);
  });

  it('handles invalid YAML gracefully', async () => {
    const nodes = await loadNodeMap('', async () => null);
    expect(nodes).toHaveLength(0);
  });
});

// ── resolveImportPath / extractImportPaths ─────────────────

describe('resolveImportPath', () => {
  it('resolves relative paths from source file location', () => {
    expect(resolveImportPath('./utils', 'src/app.ts')).toBe('src/utils');
  });

  it('resolves parent directory references', () => {
    expect(resolveImportPath('../helpers', 'src/lib/index.ts')).toBe('src/helpers');
  });
});

describe('extractImportPaths', () => {
  it('extracts ES module imports', () => {
    const code = `import { foo } from './foo';\nimport bar from './lib/bar';`;
    const paths = extractImportPaths(code, 'src/index.ts');
    expect(paths).toContain('src/foo');
    expect(paths).toContain('src/lib/bar');
  });

  it('ignores non-relative imports', () => {
    const code = `import React from 'react';\nimport { foo } from './foo';`;
    const paths = extractImportPaths(code, 'src/index.ts');
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe('src/foo');
  });

  it('extracts CommonJS require calls', () => {
    const code = `const x = require('./helpers');`;
    const paths = extractImportPaths(code, 'src/main.ts');
    expect(paths).toContain('src/helpers');
  });

  it('deduplicates paths', () => {
    const code = `import a from './x';\nimport b from './x';`;
    const paths = extractImportPaths(code, 'src/main.ts');
    expect(paths).toHaveLength(1);
  });
});
