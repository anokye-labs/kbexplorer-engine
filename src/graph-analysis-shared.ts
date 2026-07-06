/**
 * Shared parsing primitives for `validateGraph`/`assessGraph`
 * (anokye-labs/kbexplorer-engine#18, epic anokye-labs/kbexplorer-template#463).
 *
 * Both functions analyze the same narrow "authored-content graph" that
 * kbexplorer-template's `scripts/validate-graph.js` and `scripts/assess-
 * graph.js` establish: `content/*.md` frontmatter + inline `[text](target)`
 * markdown links only.
 *
 * This is deliberately **not** the fully-computed `KBGraph` from `buildGraph`
 * (`./graph`): that graph additionally folds in frontmatter `connections`,
 * synthesizes `contains` parent/child edges, and — critically —
 * auto-reconnects every orphan node to a hub or cluster sibling so no node is
 * ever left truly disconnected in the render. Reusing it here would silently
 * mask the exact structural problems (dangling links, orphan nodes, bad
 * clusters) these two functions exist to surface, breaking parity with the
 * template scripts they replace. So this module re-implements the template
 * scripts' own minimal frontmatter/link extraction verbatim (down to which
 * link prefixes are ignored) rather than delegating to `./parser`'s
 * `parseMarkdownFile`, whose inline-link rules and connection side-effects
 * differ (see the two callers' module docs for specifics).
 */
import yaml from 'yaml';

/** One authored `content/*.md` file, parsed the way both template scripts see it. */
export interface ParsedContentEntry {
  /** Repo-relative path, e.g. `content/foo.md`. */
  path: string;
  id: string;
  title: string;
  /** `null` when the frontmatter has no `cluster` field. */
  cluster: string | null;
  /** Markdown body with frontmatter stripped (not sanitized/rendered). */
  body: string;
  /** Inline `[text](target)` link targets found in `body` (external/anchor/mailto links excluded). */
  links: string[];
}

/** Minimal frontmatter parser — splits a `---` fenced YAML block from the body. Mirrors both scripts' `parseFrontmatter` exactly. */
export function parseContentFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  try {
    const parsed = yaml.parse(match[1]!) as Record<string, unknown> | null;
    return { meta: parsed ?? {}, body: match[2] ?? '' };
  } catch {
    return { meta: {}, body: raw };
  }
}

/** Strip fenced code blocks and inline code spans so link extraction doesn't match documentation examples. */
function stripCode(body: string): string {
  let stripped = body.replace(/```[\s\S]*?```/g, '');
  stripped = stripped.replace(/`[^`]+`/g, '');
  return stripped;
}

/** Extract all `[text](target)` inline links, ignoring external URLs, anchors, and `mailto:` links. */
export function extractInlineLinks(body: string): string[] {
  const clean = stripCode(body);
  const links: string[] = [];
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const target = m[2]!;
    if (target.startsWith('http://') || target.startsWith('https://')) continue;
    if (target.startsWith('#')) continue;
    if (target.startsWith('mailto:')) continue;
    links.push(target);
  }
  return links;
}

/**
 * Parse every `content/*.md` entry into the flat shape both scripts operate
 * on. Entries with no `id` in frontmatter are skipped entirely — matches
 * both scripts' `if (meta.id)` / `if (!meta.id) continue` guards.
 */
export function parseAuthoredEntries(authoredContent: Record<string, string>): ParsedContentEntry[] {
  const entries: ParsedContentEntry[] = [];
  for (const [path, raw] of Object.entries(authoredContent)) {
    const { meta, body } = parseContentFrontmatter(raw);
    const id = typeof meta.id === 'string' ? meta.id : undefined;
    if (!id) continue;
    entries.push({
      path,
      id,
      title: typeof meta.title === 'string' ? meta.title : id,
      cluster: typeof meta.cluster === 'string' ? meta.cluster : null,
      body,
      links: extractInlineLinks(body),
    });
  }
  return entries;
}

/**
 * Parse a raw `config.yaml` string into its `clusters` id → definition map.
 * A missing/unparsable config yields an empty map, matching the validate
 * script's `config.clusters || {}` fallback.
 */
export function parseConfigClusters(configRaw: string | null | undefined): Record<string, unknown> {
  if (!configRaw) return {};
  try {
    const parsed = yaml.parse(configRaw) as { clusters?: Record<string, unknown> } | null;
    return parsed?.clusters ?? {};
  } catch {
    return {};
  }
}
