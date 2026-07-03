import { describe, it, expect } from 'vitest';
import {
  parseStructuredNodeMap,
  parseStructuredContent,
  matchRule,
  applyStructuredNodeMap,
  inferStructuredNode,
  reconstructSource,
  slugify,
  type StructuredNodeMap,
} from '../structured-node-map';

// ── parseStructuredNodeMap ─────────────────────────────────

describe('parseStructuredNodeMap', () => {
  it('parses rules from yaml', () => {
    const raw = `rules:
  - id: dependabot
    glob: "**/dependabot.yml"
    shape: [version, updates]
    type: DependabotConfig
    entityType: dependabot-config`;
    const map = parseStructuredNodeMap(raw);
    expect(map.rules).toHaveLength(1);
    expect(map.rules[0].type).toBe('DependabotConfig');
  });

  it('returns empty rules for empty/invalid input', () => {
    expect(parseStructuredNodeMap('').rules).toEqual([]);
    expect(parseStructuredNodeMap(null).rules).toEqual([]);
    expect(parseStructuredNodeMap(':::not yaml:::\n  - [').rules).toEqual([]);
  });

  it('drops rules without a string type', () => {
    const map = parseStructuredNodeMap('rules:\n  - glob: "*.json"\n  - type: Good');
    expect(map.rules).toHaveLength(1);
    expect(map.rules[0].type).toBe('Good');
  });
});

// ── parseStructuredContent ─────────────────────────────────

describe('parseStructuredContent', () => {
  it('parses JSON by extension', () => {
    const r = parseStructuredContent({ path: 'a/b.json', content: '{"x":1}' });
    expect(r?.format).toBe('json');
    expect(r?.data).toEqual({ x: 1 });
  });

  it('parses YAML by extension', () => {
    const r = parseStructuredContent({ path: 'a/b.yml', content: 'x: 1\ny: two' });
    expect(r?.format).toBe('yaml');
    expect(r?.data).toEqual({ x: 1, y: 'two' });
  });

  it('returns null for prose / scalar / empty', () => {
    expect(parseStructuredContent({ path: 'a.txt', content: 'just words here' })).toBeNull();
    expect(parseStructuredContent({ path: 'a.json', content: '   ' })).toBeNull();
    expect(parseStructuredContent({ path: 'a.json', content: '42' })).toBeNull();
  });
});

// ── matchRule (glob + shape) ───────────────────────────────

describe('matchRule', () => {
  const map: StructuredNodeMap = {
    rules: [
      { id: 'dep', glob: '**/dependabot.yml', shape: ['version', 'updates'], type: 'DependabotConfig' },
      { id: 'pkg', glob: 'src/*.json', shape: ['name'], type: 'Package' },
    ],
  };

  it('matches by glob + shape', () => {
    const rule = matchRule(
      { path: '.github/dependabot.yml', content: '' },
      { version: 2, updates: [] },
      map,
    );
    expect(rule?.id).toBe('dep');
  });

  it('does not match when shape keys missing', () => {
    const rule = matchRule(
      { path: '.github/dependabot.yml', content: '' },
      { version: 2 },
      map,
    );
    expect(rule).toBeUndefined();
  });

  it('does not match when glob differs', () => {
    const rule = matchRule(
      { path: '.github/other.json', content: '' },
      { name: 'x' },
      map,
    );
    expect(rule).toBeUndefined();
  });
});

// ── applyStructuredNodeMap — mapped fixture resolves to declared @type ─

describe('applyStructuredNodeMap — declarative', () => {
  const map: StructuredNodeMap = {
    rules: [
      {
        id: 'dependabot',
        glob: '**/dependabot.yml',
        shape: ['version', 'updates'],
        type: 'DependabotConfig',
        entityType: 'dependabot-config',
        cluster: 'infra',
        titleFrom: 'name',
        fields: { schemaVersion: 'version', ecosystem: 'updates.0.package-ecosystem' },
        edges: [{ to: 'repo-meta', relation: 'structural', description: 'Configures repo' }],
      },
    ],
  };

  const file = {
    path: '.github/dependabot.yml',
    content: 'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: "/"\n',
  };

  it('resolves a mapped fixture to its declared @type and entityType', () => {
    const node = applyStructuredNodeMap(file, map)!;
    expect(node).not.toBeNull();
    expect(node.entityType).toBe('dependabot-config');
    expect(node.jsonld?.['@type']).toBe('DependabotConfig');
    expect(node.source).toEqual({ type: 'structured', entityType: 'dependabot-config', ref: file.path });
    expect(node.display).toBe('entity');
  });

  it('promotes declared fields (incl. array dot-path) into the JSON-LD envelope', () => {
    const node = applyStructuredNodeMap(file, map)!;
    expect(node.jsonld?.schemaVersion).toBe(2);
    expect(node.jsonld?.ecosystem).toBe('npm');
  });

  it('emits declared edges as structural connections', () => {
    const node = applyStructuredNodeMap(file, map)!;
    expect(node.connections.some(c => c.to === 'repo-meta' && c.relation === 'structural')).toBe(true);
  });

  it('@id reuses the identity URN', () => {
    const node = applyStructuredNodeMap(file, map)!;
    expect(node.jsonld?.['@id']).toBe(node.identity);
  });
});

// ── applyStructuredNodeMap — heuristic fallback ──────────────────────

describe('inferStructuredNode — heuristic', () => {
  it('maps an unmapped workflow shape to a workflow node', () => {
    const node = inferStructuredNode({
      path: '.github/workflows/ci.yml',
      content: 'name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n',
    })!;
    expect(node.entityType).toBe('workflow');
    expect(node.jsonld?.['@type']).toBe('Workflow');
    expect(node.title).toBe('CI');
  });

  it('maps an unmapped action shape to a github-action node', () => {
    const node = inferStructuredNode({
      path: 'action.yml',
      content: 'name: My Action\nruns:\n  using: composite\n',
    })!;
    expect(node.entityType).toBe('github-action');
    expect(node.jsonld?.['@type']).toBe('SoftwareApplication');
  });

  it('falls back to a generic structured-config node', () => {
    const node = inferStructuredNode({
      path: '.github/random.yml',
      content: 'foo: bar\nbaz: 2\n',
    })!;
    expect(node.entityType).toBe('structured-config');
    expect(node.jsonld?.['@type']).toBe('StructuredConfig');
    // unmapped node still retains its full parsed shape on data
    expect(node.data).toEqual({ foo: 'bar', baz: 2 });
  });

  it('applyStructuredNodeMap with no map runs the heuristic', () => {
    const node = applyStructuredNodeMap(
      { path: '.github/dependabot.yml', content: 'version: 2\nupdates: []\n' },
      null,
    )!;
    expect(node.entityType).toBe('dependabot-config');
  });

  it('returns null for non-structured content', () => {
    expect(applyStructuredNodeMap({ path: 'README.md', content: '# Hello\n\nprose' }, null)).toBeNull();
  });
});

// ── Reversibility ──────────────────────────────────────────

describe('reconstructSource — reversible mapping', () => {
  it('round-trips a YAML file through data', () => {
    const file = { path: '.github/dependabot.yml', content: 'version: 2\nupdates:\n  - package-ecosystem: npm\n' };
    const parsed = parseStructuredContent(file)!;
    const node = applyStructuredNodeMap(file, null)!;
    const rebuilt = reconstructSource(node);
    // semantic equality: re-parsing the reconstruction yields the original data
    const reparsed = parseStructuredContent({ path: file.path, content: rebuilt })!;
    expect(reparsed.data).toEqual(parsed.data);
  });

  it('round-trips a JSON file through data', () => {
    const file = { path: 'config/settings.json', content: '{"name":"svc","port":8080,"tags":["a","b"]}' };
    const parsed = parseStructuredContent(file)!;
    const node = applyStructuredNodeMap(file, null)!;
    const rebuilt = reconstructSource(node);
    expect(JSON.parse(rebuilt)).toEqual(parsed.data);
  });
});

// ── slugify ────────────────────────────────────────────────

describe('slugify', () => {
  it('produces url-safe ids', () => {
    expect(slugify('Hello World.yml')).toBe('hello-world-yml');
    expect(slugify('  CODEOWNERS  ')).toBe('codeowners');
  });
});
