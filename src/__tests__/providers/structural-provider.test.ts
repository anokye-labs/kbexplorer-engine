import { describe, it, expect, beforeEach } from 'vitest';
import { StructuralProvider, parseCodeowners, buildStructuralFileNode } from '../../providers/structural-provider';
import { resetNodeTypeRegistry, resolveType } from '../../node-types';
import { resetViewerRegistry, resolveViewer } from '../../../views/viewers';
import { WorkflowView } from '../../../views/viewers/WorkflowView';
import { ActionView } from '../../../views/viewers/ActionView';
import { SkillView } from '../../../views/viewers/SkillView';
import { parseStructuredNodeMap } from '../../node-map';
import type { KBConfig } from '../../../types';
import { DEFAULT_CONFIG } from '../../../types';

const config: KBConfig = DEFAULT_CONFIG;

const WORKFLOW = `name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`;

const ACTION = `name: Setup Tool
description: Installs the tool
inputs:
  version:
    description: Version to install
    required: true
outputs:
  path:
    description: Install path
runs:
  using: composite
`;

const DEPENDABOT = `version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
`;

const CODEOWNERS = `# owners
*       @org/maintainers
/src/   @org/eng @alice
`;

const ISSUE_TEMPLATE_MD = `---
name: Bug report
about: Report a bug
labels: [bug]
---

## Describe the bug
Steps to reproduce.
`;

const PR_TEMPLATE = `## Summary

Describe your change.
`;

const FUNDING = `github: [octocat]
`;

function makeFiles(): Record<string, string> {
  return {
    '.github/workflows/ci.yml': WORKFLOW,
    '.github/actions/setup/action.yml': ACTION,
    '.github/dependabot.yml': DEPENDABOT,
    '.github/CODEOWNERS': CODEOWNERS,
    '.github/ISSUE_TEMPLATE/bug.md': ISSUE_TEMPLATE_MD,
    '.github/PULL_REQUEST_TEMPLATE.md': PR_TEMPLATE,
    '.github/FUNDING.yml': FUNDING,
  };
}

describe('StructuralProvider', () => {
  beforeEach(() => {
    resetNodeTypeRegistry();
    resetViewerRegistry();
  });

  it('is a safe no-op when there are no structural files', async () => {
    const provider = new StructuralProvider({});
    const { nodes, edges } = await provider.resolve(config, []);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  it('discovers each .github kind as a typed node', async () => {
    const provider = new StructuralProvider(makeFiles());
    const { nodes } = await provider.resolve(config, []);

    const byType = new Set(nodes.map(n => n.entityType));
    expect(byType).toContain('workflow');
    expect(byType).toContain('github-action');
    expect(byType).toContain('dependabot-config');
    expect(byType).toContain('codeowners');
    expect(byType).toContain('issue-template');
    expect(byType).toContain('pr-template');
    expect(byType).toContain('funding-config');
  });

  it('links every structural node to the repository node via a structural relation', async () => {
    const provider = new StructuralProvider(makeFiles());
    const { nodes } = await provider.resolve(config, []);

    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      const conn = node.connections.find(c => c.to === 'repo-meta');
      expect(conn, `${node.id} should connect to repo-meta`).toBeDefined();
      expect(conn?.relation).toBe('structural');
    }
  });

  it('tags every node with provider: structural and derived', async () => {
    const { nodes } = await new StructuralProvider(makeFiles()).resolve(config, []);
    for (const node of nodes) {
      expect(node.provider).toBe('structural');
      expect(node.derived).toBe(true);
    }
  });

  it('uses the workflow NodeSource for workflows', async () => {
    const { nodes } = await new StructuralProvider(makeFiles()).resolve(config, []);
    const wf = nodes.find(n => n.entityType === 'workflow')!;
    expect(wf.source).toEqual({ type: 'workflow', path: '.github/workflows/ci.yml' });
    expect(wf.jsonld?.['@type']).toBe('Workflow');
    expect(wf.title).toBe('CI');
    // full parsed workflow retained on data for the viewer
    expect(wf.data?.jobs).toBeDefined();
  });

  it('registers structural types + bespoke viewers', async () => {
    await new StructuralProvider(makeFiles()).resolve(config, []);
    expect(resolveType('workflow')?.layer).toBe('work');
    expect(resolveType('github-action')?.cluster).toBe('infra');
    expect(resolveViewer({ entityType: 'workflow', jsonld: undefined })).toBe(WorkflowView);
    expect(resolveViewer({ entityType: 'github-action', jsonld: undefined })).toBe(ActionView);
  });

  it('discovers a .github/skills/**/SKILL.md as a skill node with a bespoke viewer', async () => {
    const SKILL = `---
name: kbexplorer
description: Use when the user asks to set up or explore a knowledge base.
version: 0.1.0
---

# kbexplorer

Guidance body with a [link](https://example.com) and **bold** text.

A [dangerous link](javascript:alert(1)) plus raw <script>alert('xss')</script> markup.
`;
    const provider = new StructuralProvider({
      '.github/skills/kbexplorer/SKILL.md': SKILL,
    });
    const { nodes } = await provider.resolve(config, []);

    const skill = nodes.find(n => n.entityType === 'skill');
    expect(skill, 'a skill node should be produced').toBeDefined();
    expect(skill!.id).toBe('gh-skill-kbexplorer');
    expect(skill!.title).toBe('kbexplorer');
    expect(skill!.jsonld?.['@type']).toBe('HowTo');
    expect(skill!.jsonld?.['version']).toBe('0.1.0');
    expect(skill!.data?.description).toContain('set up or explore');
    // body rendered to HTML on content
    expect(skill!.content).toContain('<h1');
    // raw embedded HTML is escaped, never emitted as live markup (XSS-safe)
    expect(skill!.content).toContain('&lt;script');
    expect(skill!.content).not.toContain('<script>');
    // dangerous link URLs (javascript:/data:/vbscript:) are neutralized
    expect(skill!.content).not.toContain('javascript:');
    // linked to the repository node via a structural relation
    const conn = skill!.connections.find(c => c.to === 'repo-meta');
    expect(conn?.relation).toBe('structural');
    // resolves to the bespoke SkillView
    expect(resolveViewer({ entityType: 'skill', jsonld: undefined })).toBe(SkillView);
    expect(resolveType('skill')?.cluster).toBe('infra');
  });

  it('honours a custom repo node id', async () => {
    const { nodes } = await new StructuralProvider(
      { '.github/dependabot.yml': DEPENDABOT },
      null,
      'repository',
    ).resolve(config, []);
    expect(nodes[0].connections[0].to).toBe('repository');
  });

  it('routes unrecognised .github config through the declarative node-map', async () => {
    const map = `rules:
  - id: labeler
    glob: ".github/labeler.yml"
    type: LabelerConfig
    entityType: labeler-config`;
    const { nodes } = await new StructuralProvider(
      { '.github/labeler.yml': 'frontend:\n  - "src/**"\n' },
      map,
    ).resolve(config, []);
    const node = nodes.find(n => n.entityType === 'labeler-config');
    expect(node).toBeDefined();
    expect(node?.jsonld?.['@type']).toBe('LabelerConfig');
    expect(node?.connections.some(c => c.to === 'repo-meta' && c.relation === 'structural')).toBe(true);
  });

  it('falls back to a heuristic typed node for unmapped structured config', async () => {
    const { nodes } = await new StructuralProvider(
      { '.github/misc.yml': 'foo: bar\n' },
      null,
    ).resolve(config, []);
    const node = nodes.find(n => n.source.type === 'structured' && n.source.ref === '.github/misc.yml');
    expect(node).toBeDefined();
    expect(node?.entityType).toBe('structured-config');
  });
});

describe('parseCodeowners', () => {
  it('parses patterns and owners, ignoring comments/blanks', () => {
    const rules = parseCodeowners(CODEOWNERS);
    expect(rules).toEqual([
      { pattern: '*', owners: ['@org/maintainers'] },
      { pattern: '/src/', owners: ['@org/eng', '@alice'] },
    ]);
  });
});

describe('buildStructuralFileNode', () => {
  const emptyMap = parseStructuredNodeMap(null);

  it('renders a markdown PR template as prose (no structured data)', () => {
    const node = buildStructuralFileNode('.github/PULL_REQUEST_TEMPLATE.md', PR_TEMPLATE, emptyMap)!;
    expect(node.entityType).toBe('pr-template');
    expect(node.display).toBeUndefined();
    expect(node.content).toContain('Describe your change');
  });

  it('renders an issue template with frontmatter as an entity', () => {
    const node = buildStructuralFileNode('.github/ISSUE_TEMPLATE/bug.md', ISSUE_TEMPLATE_MD, emptyMap)!;
    expect(node.entityType).toBe('issue-template');
    expect(node.display).toBe('entity');
    expect(node.title).toBe('Bug report');
    expect(node.data?.labels).toEqual(['bug']);
  });

  it('builds an action node with inputs/outputs retained', () => {
    const node = buildStructuralFileNode('.github/actions/setup/action.yml', ACTION, emptyMap)!;
    expect(node.entityType).toBe('github-action');
    expect((node.data as { inputs?: unknown }).inputs).toBeDefined();
    expect((node.data as { outputs?: unknown }).outputs).toBeDefined();
  });

  it('returns null for binary/non-string content', () => {
    expect(buildStructuralFileNode('.github/x.bin', undefined as unknown as string, emptyMap)).toBeNull();
  });
});
