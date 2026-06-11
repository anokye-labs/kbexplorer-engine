/**
 * StructuralProvider — discovers `.github` repo-structural artifacts and emits
 * them as first-class graph nodes linked to the repository node (Feature F3 /
 * #167).
 *
 * "Almost everything in `.github`" becomes a graph citizen: workflows, composite
 * actions, issue / PR templates, CODEOWNERS, dependabot & funding config, plus
 * any other structured config (mapped via the declarative `node-map.yaml` +
 * heuristic fallback from {@link applyNodeMap}). Every produced node carries a
 * `structural` relation edge to the repository (`repo-meta`) node.
 *
 * Strictly additive and guarded: with no structural files the provider is a
 * safe no-op (`{ nodes: [], edges: [] }`), so existing graph output is
 * byte-identical for repos without a `.github` directory.
 */
import yaml from 'yaml';
import { Marked, type Tokens } from 'marked';
import type { GraphProvider, ProviderResult } from '../providers';
import type { KBConfig, KBNode, NodeSource, Connection } from '../../types';
import { buildJsonLd } from '../../types';
import { registerType } from '../node-types';
import { registerViewer } from '../../views/viewers';
import { WorkflowView } from '../../views/viewers/WorkflowView';
import { ActionView } from '../../views/viewers/ActionView';
import {
  applyNodeMap,
  parseStructuredNodeMap,
  slugify,
  type StructuredNodeMap,
} from '../node-map';

/** Default id of the repository node these structural nodes attach to. */
const REPO_NODE_ID = 'repo-meta';
const STRUCTURAL_CLUSTER = 'infra';

/**
 * Markdown → HTML for `.github` docs/templates. Unlike the app-wide renderer,
 * this **escapes raw embedded HTML** (#168 review): markup committed under
 * `.github/` (issue/PR templates, SECURITY.md, …) is treated as untrusted, so
 * it can't inject script/markup into the DOM when the node is rendered via
 * `dangerouslySetInnerHTML`.
 */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const safeMarkdown = new Marked({
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(token.text ?? '');
    },
  },
});

function renderSafeMarkdown(body: string): string {
  return safeMarkdown.parse(body, { async: false }) as string;
}

// ── Type + viewer registration ─────────────────────────────

/**
 * Register the structural node types + their bespoke viewers. Idempotent — safe
 * to call on every `resolve()`.
 */
export function registerStructuralTypes(): void {
  registerType({ id: 'workflow', label: 'Workflow', layer: 'work', cluster: STRUCTURAL_CLUSTER, relations: ['structural'], viewer: 'workflow', description: 'A GitHub Actions workflow.' });
  registerType({ id: 'github-action', label: 'Action', layer: 'work', cluster: STRUCTURAL_CLUSTER, relations: ['structural'], viewer: 'github-action', description: 'A composite or JS GitHub Action.' });
  registerType({ id: 'issue-template', label: 'Issue Template', layer: 'work', cluster: STRUCTURAL_CLUSTER, relations: ['structural'], description: 'A GitHub issue template / form.' });
  registerType({ id: 'pr-template', label: 'PR Template', layer: 'work', cluster: STRUCTURAL_CLUSTER, relations: ['structural'], description: 'A pull-request template.' });
  registerType({ id: 'codeowners', label: 'CODEOWNERS', layer: 'work', cluster: STRUCTURAL_CLUSTER, relations: ['structural'], description: 'Code ownership rules.' });
  registerType({ id: 'dependabot-config', label: 'Dependabot', layer: 'work', cluster: STRUCTURAL_CLUSTER, relations: ['structural'], description: 'Dependabot update configuration.' });
  registerType({ id: 'funding-config', label: 'Funding', layer: 'work', cluster: STRUCTURAL_CLUSTER, relations: ['structural'], description: 'Repository funding links.' });
  registerType({ id: 'github-config', label: 'Repo Config', layer: 'work', cluster: STRUCTURAL_CLUSTER, relations: ['structural'], description: 'Generic repository configuration file.' });
  registerType({ id: 'structured-config', label: 'Config', layer: 'work', cluster: STRUCTURAL_CLUSTER, relations: ['structural'], description: 'Heuristically-typed structured config.' });

  registerViewer('workflow', WorkflowView);
  registerViewer('github-action', ActionView);
}

// ── Path classification ────────────────────────────────────

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

function isWorkflow(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path);
}
function isAction(path: string): boolean {
  return /(^|\/)action\.ya?ml$/i.test(path);
}
function isIssueTemplate(path: string): boolean {
  return /^\.github\/ISSUE_TEMPLATE\/.+/i.test(path) && !/\/config\.ya?ml$/i.test(path);
}
function isIssueTemplateConfig(path: string): boolean {
  return /^\.github\/ISSUE_TEMPLATE\/config\.ya?ml$/i.test(path);
}
function isPrTemplate(path: string): boolean {
  return (
    /^\.github\/(PULL_REQUEST_TEMPLATE|pull_request_template)\.md$/i.test(path) ||
    /^\.github\/PULL_REQUEST_TEMPLATE\/.+\.md$/i.test(path)
  );
}
function isCodeowners(path: string): boolean {
  return /(^|\/)CODEOWNERS$/.test(path);
}
function isDependabot(path: string): boolean {
  return /^\.github\/dependabot\.ya?ml$/i.test(path);
}
function isFunding(path: string): boolean {
  return /^\.github\/FUNDING\.ya?ml$/i.test(path);
}

// ── Node helpers ───────────────────────────────────────────

function structuralConnection(to: string, description: string): Connection {
  return { to, type: 'contains', relation: 'structural', description, source: 'inferred', weight: 5 };
}

interface BuildArgs {
  id: string;
  title: string;
  entityType: string;
  ldType: string;
  source: NodeSource;
  identity: string;
  emoji: string;
  data?: Record<string, unknown>;
  ldProps?: Record<string, unknown>;
  content?: string;
  rawContent?: string;
  display?: KBNode['display'];
  repoNodeId: string;
}

function buildStructuralNode(args: BuildArgs): KBNode {
  return {
    id: args.id,
    title: args.title,
    cluster: STRUCTURAL_CLUSTER,
    content: args.content ?? '',
    rawContent: args.rawContent ?? '',
    emoji: args.emoji,
    display: args.display,
    connections: [structuralConnection(args.repoNodeId, `${args.title} configures the repository`)],
    identity: args.identity,
    derived: true,
    source: args.source,
    provider: 'structural',
    entityType: args.entityType,
    data: args.data,
    jsonld: buildJsonLd({ id: args.id, identity: args.identity }, args.ldType, args.ldProps ?? {}),
  };
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  try {
    const data = yaml.parse(match[1]) as Record<string, unknown>;
    return { data: data ?? {}, body: match[2] };
  } catch {
    return { data: {}, body: raw };
  }
}

function safeYaml(content: string): Record<string, unknown> {
  try {
    const parsed = yaml.parse(content) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Parse a CODEOWNERS file into `{ pattern, owners }` rules. */
export function parseCodeowners(content: string): Array<{ pattern: string; owners: string[] }> {
  const rules: Array<{ pattern: string; owners: string[] }> = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    const pattern = parts.shift();
    if (!pattern) continue;
    rules.push({ pattern, owners: parts });
  }
  return rules;
}

// ── Per-kind builders ──────────────────────────────────────

function buildWorkflowNode(path: string, content: string, repoNodeId: string): KBNode {
  const data = safeYaml(content);
  const name = (typeof data.name === 'string' && data.name) || fileName(path);
  return buildStructuralNode({
    id: `gh-workflow-${slugify(fileName(path))}`,
    title: name,
    entityType: 'workflow',
    ldType: 'Workflow',
    source: { type: 'workflow', path },
    identity: `urn:structural:${path}`,
    emoji: 'Flow',
    data,
    ldProps: { name },
    display: 'entity',
    repoNodeId,
  });
}

function buildActionNode(path: string, content: string, repoNodeId: string): KBNode {
  const data = safeYaml(content);
  const name = (typeof data.name === 'string' && data.name) || fileName(path);
  return buildStructuralNode({
    id: `gh-action-${slugify(path)}`,
    title: name,
    entityType: 'github-action',
    ldType: 'SoftwareApplication',
    source: { type: 'structured', entityType: 'github-action', ref: path },
    identity: `urn:structural:${path}`,
    emoji: 'PuzzlePiece',
    data,
    ldProps: { name },
    display: 'entity',
    repoNodeId,
  });
}

function buildMarkdownTemplateNode(
  path: string,
  content: string,
  entityType: 'issue-template' | 'pr-template',
  ldType: string,
  emoji: string,
  repoNodeId: string,
): KBNode {
  const { data, body } = parseFrontmatter(content);
  const title =
    (typeof data.name === 'string' && data.name) ||
    (typeof data.about === 'string' && data.about) ||
    fileName(path);
  const hasData = Object.keys(data).length > 0;
  const html = renderSafeMarkdown(body);
  return buildStructuralNode({
    id: `gh-${entityType}-${slugify(fileName(path))}`,
    title,
    entityType,
    ldType,
    source: { type: 'structured', entityType, ref: path },
    identity: `urn:structural:${path}`,
    emoji,
    data: hasData ? data : undefined,
    ldProps: typeof data.name === 'string' ? { name: data.name } : {},
    content: html,
    rawContent: body,
    display: hasData ? 'entity' : undefined,
    repoNodeId,
  });
}

function buildYamlFormNode(path: string, content: string, repoNodeId: string): KBNode {
  const data = safeYaml(content);
  const name = (typeof data.name === 'string' && data.name) || fileName(path);
  return buildStructuralNode({
    id: `gh-issue-template-${slugify(fileName(path))}`,
    title: name,
    entityType: 'issue-template',
    ldType: 'CreativeWork',
    source: { type: 'structured', entityType: 'issue-template', ref: path },
    identity: `urn:structural:${path}`,
    emoji: 'TextBulletListSquare',
    data,
    ldProps: { name },
    display: 'entity',
    repoNodeId,
  });
}

function buildCodeownersNode(path: string, content: string, repoNodeId: string): KBNode {
  const rules = parseCodeowners(content);
  return buildStructuralNode({
    id: `gh-codeowners-${slugify(path)}`,
    title: 'CODEOWNERS',
    entityType: 'codeowners',
    ldType: 'StructuredConfig',
    source: { type: 'structured', entityType: 'codeowners', ref: path },
    identity: `urn:structural:${path}`,
    emoji: 'People',
    data: { rules },
    ldProps: { ruleCount: rules.length },
    display: 'entity',
    repoNodeId,
  });
}

function buildDependabotNode(path: string, content: string, repoNodeId: string): KBNode {
  const data = safeYaml(content);
  return buildStructuralNode({
    id: `gh-dependabot-${slugify(fileName(path))}`,
    title: 'Dependabot',
    entityType: 'dependabot-config',
    ldType: 'DependabotConfig',
    source: { type: 'structured', entityType: 'dependabot-config', ref: path },
    identity: `urn:structural:${path}`,
    emoji: 'ArrowSync',
    data,
    ldProps: typeof data.version !== 'undefined' ? { schemaVersion: data.version } : {},
    display: 'entity',
    repoNodeId,
  });
}

function buildFundingNode(path: string, content: string, repoNodeId: string): KBNode {
  const data = safeYaml(content);
  return buildStructuralNode({
    id: `gh-funding-${slugify(fileName(path))}`,
    title: 'Funding',
    entityType: 'funding-config',
    ldType: 'StructuredConfig',
    source: { type: 'structured', entityType: 'funding-config', ref: path },
    identity: `urn:structural:${path}`,
    emoji: 'Heart',
    data,
    display: 'entity',
    repoNodeId,
  });
}

function isMarkdown(path: string): boolean {
  return /\.m*md$/i.test(path) || /\.markdown$/i.test(path);
}

function buildGenericConfigNode(
  path: string,
  content: string,
  map: StructuredNodeMap,
  repoNodeId: string,
): KBNode | null {
  // Try the declarative map + heuristic structured mapper first.
  const mapped = applyNodeMap({ path, content }, map, {
    id: `gh-config-${slugify(path)}`,
    cluster: STRUCTURAL_CLUSTER,
  });
  if (mapped) {
    mapped.provider = 'structural';
    mapped.derived = true;
    if (!mapped.connections.some(c => c.to === repoNodeId)) {
      mapped.connections.push(structuralConnection(repoNodeId, `${mapped.title} configures the repository`));
    }
    return mapped;
  }

  // Markdown / prose `.github` doc (e.g. SUPPORT.md, SECURITY.md) → doc node.
  if (isMarkdown(path)) {
    const { data, body } = parseFrontmatter(content);
    const html = renderSafeMarkdown(body);
    const hasData = Object.keys(data).length > 0;
    return buildStructuralNode({
      id: `gh-doc-${slugify(fileName(path))}`,
      title: (typeof data.name === 'string' && data.name) || fileName(path),
      entityType: 'github-config',
      ldType: 'CreativeWork',
      source: { type: 'structured', entityType: 'github-config', ref: path },
      identity: `urn:structural:${path}`,
      emoji: 'Document',
      data: hasData ? data : undefined,
      content: html,
      rawContent: body,
      display: hasData ? 'entity' : undefined,
      repoNodeId,
    });
  }

  return null;
}

/** Build a structural node for a single `.github` file, or `null` to skip it. */
export function buildStructuralFileNode(
  path: string,
  content: string,
  map: StructuredNodeMap,
  repoNodeId: string = REPO_NODE_ID,
): KBNode | null {
  if (typeof content !== 'string') return null;
  if (isWorkflow(path)) return buildWorkflowNode(path, content, repoNodeId);
  if (isAction(path)) return buildActionNode(path, content, repoNodeId);
  if (isDependabot(path)) return buildDependabotNode(path, content, repoNodeId);
  if (isFunding(path)) return buildFundingNode(path, content, repoNodeId);
  if (isCodeowners(path)) return buildCodeownersNode(path, content, repoNodeId);
  if (isIssueTemplateConfig(path)) return buildYamlFormNode(path, content, repoNodeId);
  if (isIssueTemplate(path)) {
    return isMarkdown(path)
      ? buildMarkdownTemplateNode(path, content, 'issue-template', 'CreativeWork', 'TextBulletListSquare', repoNodeId)
      : buildYamlFormNode(path, content, repoNodeId);
  }
  if (isPrTemplate(path)) {
    return buildMarkdownTemplateNode(path, content, 'pr-template', 'CreativeWork', 'BranchRequest', repoNodeId);
  }
  return buildGenericConfigNode(path, content, map, repoNodeId);
}

// ── Provider ───────────────────────────────────────────────

export class StructuralProvider implements GraphProvider {
  id = 'structural';
  name = 'Repo Structure';
  dependencies = ['work'];

  private readonly structuralFiles: Record<string, string>;
  private readonly structuredNodeMapRaw: string | null;
  private readonly repoNodeId: string;

  constructor(
    structuralFiles: Record<string, string> = {},
    structuredNodeMapRaw: string | null = null,
    repoNodeId: string = REPO_NODE_ID,
  ) {
    this.structuralFiles = structuralFiles;
    this.structuredNodeMapRaw = structuredNodeMapRaw;
    this.repoNodeId = repoNodeId;
  }

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    const entries = Object.entries(this.structuralFiles ?? {});
    if (entries.length === 0) return { nodes: [], edges: [] };

    registerStructuralTypes();
    const map = parseStructuredNodeMap(this.structuredNodeMapRaw);

    const nodes: KBNode[] = [];
    const seen = new Set<string>();
    for (const [path, content] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      const node = buildStructuralFileNode(path, content, map, this.repoNodeId);
      if (!node) continue;
      // Guard against id collisions (deterministic last-wins would drop edges).
      let id = node.id;
      let n = 2;
      while (seen.has(id)) id = `${node.id}-${n++}`;
      node.id = id;
      seen.add(id);
      nodes.push(node);
    }

    return { nodes, edges: [] };
  }
}
