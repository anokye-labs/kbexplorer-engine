import { describe, it, expect } from 'vitest';
import type { KBConfig, KBNode, NodeSourceFile } from '@anokye-labs/kbexplorer-core';
import {
  canEditSource,
  resolveSourceFile,
  validateSourceContent,
  repoCoordsFromConfig,
  encodeRepoPath,
  buildEditUrl,
  buildNewFileUrl,
  buildHandoffUrl,
  buildUnifiedDiff,
  patchFilename,
  buildSourceEditHandoff,
} from '../source-edit';

// Provenance note (slice 1/5, anokye-labs/kbexplorer-template#472): this is
// template's original `source-edit.test.ts`, ported with its `content-model`
// -dependent cases removed — `content-model` (and its test fixtures) doesn't
// move until slice 2. The dropped cases were:
//   - "the content-model builder attaches the underlying file path + raw to
//     entity nodes" (calls `buildContentModel`/`loadFixtureSource`)
//   - "unresolved stub nodes carry no source file" (same dependency)
// Both exercise `content-model`'s own output shape, not `source-edit.ts`
// logic, so no coverage of this file's exported functions is lost. They
// should resume here once `content-model` migrates in slice 2.

const COORDS = { owner: 'anokye-labs', repo: 'kbexplorer-template', branch: 'main' };

function configWith(source: Partial<KBConfig['source']>): KBConfig {
  return { source: { owner: 'o', repo: 'r', branch: 'b', ...source } } as KBConfig;
}

function nodeWith(sourceFile?: NodeSourceFile): KBNode {
  return {
    id: 'n',
    title: 'n',
    cluster: 'person',
    content: '',
    rawContent: '',
    connections: [],
    source: { type: 'structured', entityType: 'person' },
    ...(sourceFile !== undefined ? { sourceFile } : {}),
  };
}

// ── (a) the editor resolves a node's source-of-truth file content ──────────

describe('source-edit — resolving the source-of-truth file (F5 / #152)', () => {
  it('resolveSourceFile returns the file when present', () => {
    const file: NodeSourceFile = { path: 'content-model/people/ada.yaml', raw: 'id: ada\n', format: 'yaml' };
    expect(resolveSourceFile(nodeWith(file))).toEqual(file);
  });
});

// ── (b) the GitHub deep-link URL is constructed correctly ──────────────────

describe('source-edit — GitHub deep-link construction (F5 / #152)', () => {
  it('repoCoordsFromConfig reads owner/repo/branch and defaults branch to main', () => {
    expect(repoCoordsFromConfig(configWith({ owner: 'a', repo: 'b', branch: 'dev' })))
      .toEqual({ owner: 'a', repo: 'b', branch: 'dev' });
    const configNoBranch = { source: { owner: 'a', repo: 'b' } } as KBConfig;
    expect(repoCoordsFromConfig(configNoBranch).branch).toBe('main');
    expect(repoCoordsFromConfig(configWith({ owner: 'a', repo: 'b', branch: '  ' })).branch).toBe('main');
  });

  it('builds the web-editor URL for an EXISTING file', () => {
    expect(buildEditUrl(COORDS, 'content-model/people/ada.yaml'))
      .toBe('https://github.com/anokye-labs/kbexplorer-template/edit/main/content-model/people/ada.yaml');
  });

  it('builds the create-file URL for a NEW file, pre-filled with path + content', () => {
    const url = buildNewFileUrl(COORDS, 'content-model/people/zoe.yaml', 'id: zoe\nname: Zoe\n');
    expect(url.startsWith('https://github.com/anokye-labs/kbexplorer-template/new/main?')).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get('filename')).toBe('content-model/people/zoe.yaml');
    expect(params.get('value')).toBe('id: zoe\nname: Zoe\n');
  });

  it('buildHandoffUrl picks edit for existing files and new-file for new ones', () => {
    const path = 'content-model/people/ada.yaml';
    expect(buildHandoffUrl(COORDS, path, 'x', true)).toBe(buildEditUrl(COORDS, path));
    expect(buildHandoffUrl(COORDS, path, 'x', false)).toBe(buildNewFileUrl(COORDS, path, 'x'));
  });

  it('encodes path segments while preserving slashes', () => {
    expect(encodeRepoPath('content-model/squads/x cloud/a b.yaml'))
      .toBe('content-model/squads/x%20cloud/a%20b.yaml');
  });

  it('assembles a full handoff for an edited existing file', () => {
    const file: NodeSourceFile = { path: 'content-model/people/ada.yaml', raw: 'id: ada\n', format: 'yaml' };
    const handoff = buildSourceEditHandoff(COORDS, file, 'id: ada\nname: Ada\n');
    expect(handoff.changed).toBe(true);
    expect(handoff.exists).toBe(true);
    expect(handoff.url).toBe(buildEditUrl(COORDS, file.path));
    expect(handoff.newFileUrl).toContain('/new/main?');
    expect(handoff.patch).toContain('+name: Ada');
    expect(handoff.patchName).toBe('ada.yaml.patch');
  });

  it('reports no change when content is identical', () => {
    const file: NodeSourceFile = { path: 'a.yaml', raw: 'id: a\n', format: 'yaml' };
    const handoff = buildSourceEditHandoff(COORDS, file, 'id: a\n');
    expect(handoff.changed).toBe(false);
    expect(handoff.patch).toBe('');
  });

  it('is newline-agnostic: a CRLF checkout vs an LF textarea is not a spurious change', () => {
    // file.raw arrives with CRLF (Windows checkout); the textarea emits LF.
    const file: NodeSourceFile = { path: 'content-model/people/ada.yaml', raw: 'id: ada\r\nrole: Lead\r\n', format: 'yaml' };
    const unchanged = buildSourceEditHandoff(COORDS, file, 'id: ada\nrole: Lead\n');
    expect(unchanged.changed).toBe(false);
    expect(unchanged.patch).toBe('');
    // a genuine one-line edit yields a one-line diff, not a whole-file rewrite
    const edited = buildSourceEditHandoff(COORDS, file, 'id: ada\nrole: Principal Lead\n');
    expect(edited.changed).toBe(true);
    expect(edited.patch).toContain('-role: Lead');
    expect(edited.patch).toContain('+role: Principal Lead');
    expect(edited.patch).toContain(' id: ada');
  });

  it('patchFilename uses the file basename', () => {
    expect(patchFilename('content-model/squads/xcloud/streaming.yaml')).toBe('streaming.yaml.patch');
  });
});

// ── (c) invalid YAML/JSON is caught before handoff ─────────────────────────

describe('source-edit — validation before handoff (F5 / #152)', () => {
  it('accepts valid YAML', () => {
    expect(validateSourceContent('id: ada\nname: Ada\n', 'yaml')).toEqual({ ok: true });
  });

  it('rejects malformed YAML', () => {
    const result = validateSourceContent('id: ada\n  bad:\n: : :\n', 'yaml');
    expect(result.ok).toBe(false);
  });

  it('accepts valid JSON and rejects malformed JSON', () => {
    expect(validateSourceContent('{"id":"ada"}', 'json')).toEqual({ ok: true });
    expect(validateSourceContent('{"id":}', 'json').ok).toBe(false);
  });

  it('rejects empty content', () => {
    expect(validateSourceContent('   \n', 'yaml').ok).toBe(false);
  });
});

// ── (d) nodes without a source file expose no editor affordance ────────────

describe('source-edit — no affordance without a writable source (F5 / #152)', () => {
  it('canEditSource is false when sourceFile is absent', () => {
    expect(canEditSource(nodeWith(undefined))).toBe(false);
    expect(resolveSourceFile(nodeWith(undefined))).toBeNull();
  });

  it('canEditSource is false for an empty path or missing raw', () => {
    expect(canEditSource(nodeWith({ path: '', raw: 'x', format: 'yaml' }))).toBe(false);
    expect(canEditSource({ sourceFile: { path: 'a.yaml', format: 'yaml' } as NodeSourceFile })).toBe(false);
  });

  it('canEditSource is false when the runtime format is missing or unknown', () => {
    // Cached/loaded data could carry an invalid `format`; an invalid shape must
    // expose no affordance rather than crash the editor later.
    expect(canEditSource({ sourceFile: { path: 'a.yaml', raw: 'x' } as unknown as NodeSourceFile })).toBe(false);
    expect(
      canEditSource({ sourceFile: { path: 'a.txt', raw: 'x', format: 'txt' } as unknown as NodeSourceFile }),
    ).toBe(false);
    expect(resolveSourceFile({ sourceFile: { path: 'a.yaml', raw: 'x', format: 'xml' } as unknown as NodeSourceFile }))
      .toBeNull();
    // a well-formed pointer with a known format is still editable
    expect(canEditSource(nodeWith({ path: 'a.yaml', raw: 'x', format: 'yaml' }))).toBe(true);
    expect(canEditSource(nodeWith({ path: 'a.json', raw: '{}', format: 'json' }))).toBe(true);
  });

  it('a README-style node (no sourceFile) is not editable', () => {
    const readme: KBNode = {
      id: 'readme', title: 'README', cluster: 'docs', content: '', rawContent: '',
      connections: [], source: { type: 'readme' },
    };
    expect(canEditSource(readme)).toBe(false);
  });
});

// ── unified diff fidelity ──────────────────────────────────────────────────

describe('source-edit — unified diff (F5 / #152)', () => {
  it('produces a git-style header and +/- lines for a single-field change', () => {
    const before = 'id: ada\nname: Ada\nrole: Lead\n';
    const after = 'id: ada\nname: Ada Okonkwo\nrole: Lead\n';
    const patch = buildUnifiedDiff('content-model/people/ada.yaml', before, after);
    expect(patch).toContain('diff --git a/content-model/people/ada.yaml b/content-model/people/ada.yaml');
    expect(patch).toContain('--- a/content-model/people/ada.yaml');
    expect(patch).toContain('+++ b/content-model/people/ada.yaml');
    expect(patch).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(patch).toContain('-name: Ada');
    expect(patch).toContain('+name: Ada Okonkwo');
    // unchanged lines are retained as context
    expect(patch).toContain(' id: ada');
    expect(patch).toContain(' role: Lead');
  });

  it('returns an empty patch when nothing changed', () => {
    expect(buildUnifiedDiff('a.yaml', 'x\n', 'x\n')).toBe('');
  });

  it('uses git new-file headers (/dev/null + new file mode) when isNew is set', () => {
    const patch = buildUnifiedDiff('content-model/people/zoe.yaml', '', 'id: zoe\nname: Zoe\n', 3, true);
    expect(patch).toContain('diff --git a/content-model/people/zoe.yaml b/content-model/people/zoe.yaml');
    expect(patch).toContain('new file mode 100644');
    expect(patch).toContain('--- /dev/null');
    expect(patch).toContain('+++ b/content-model/people/zoe.yaml');
    // a brand-new file is all additions, anchored at -0,0
    expect(patch).toMatch(/@@ -0,0 \+1,\d+ @@/);
    expect(patch).toContain('+id: zoe');
    expect(patch).not.toContain('--- a/content-model/people/zoe.yaml');
  });

  it('a NEW-file handoff (exists=false) produces a git-applicable new-file patch', () => {
    const file: NodeSourceFile = { path: 'content-model/people/zoe.yaml', raw: '', format: 'yaml' };
    const handoff = buildSourceEditHandoff(COORDS, file, 'id: zoe\nname: Zoe\n', false);
    expect(handoff.exists).toBe(false);
    expect(handoff.url).toBe(buildNewFileUrl(COORDS, file.path, 'id: zoe\nname: Zoe\n'));
    expect(handoff.patch).toContain('--- /dev/null');
    expect(handoff.patch).toContain('new file mode 100644');
  });

  it('falls back to a coarse replace-all diff above the LCS size guard', () => {
    // Pathologically large inputs must not allocate an O(m·n) DP table; the
    // result is still a valid patch (all old lines removed, all new lines added).
    const before = Array.from({ length: 6000 }, (_, i) => `old-${i}`).join('\n') + '\n';
    const after = Array.from({ length: 6000 }, (_, i) => `new-${i}`).join('\n') + '\n';
    const patch = buildUnifiedDiff('big.yaml', before, after);
    expect(patch).toContain('--- a/big.yaml');
    expect(patch).toContain('+++ b/big.yaml');
    expect(patch).toContain('-old-0');
    expect(patch).toContain('+new-0');
    expect(patch).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });
});
