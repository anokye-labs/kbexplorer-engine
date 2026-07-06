/**
 * `enrichFromManifest` — faithful port of kbexplorer-template's
 * `scripts/enrich-context.js` (anokye-labs/kbexplorer-engine#19).
 *
 * Cross-references every catalogue node with a {@link RepoManifest}'s issues,
 * pull requests, and commits, attaching `relatedIssues` / `relatedPRs` /
 * `recentCommits` to each node. Pure and source-agnostic: the template script
 * reads `content/catalogue.json` and `src/generated/repo-manifest.json` off
 * disk and writes `content/catalogue-enriched.json` itself; this helper takes
 * the already-parsed catalogue + manifest and returns the enriched result —
 * writing it out is the CLI's job.
 */
import type { RepoManifest } from '../sources/repo-manifest';
import type { Catalogue, CatalogueNode } from './types';

const SNIPPET_LENGTH = 200;
const MAX_RELATED_ISSUES = 5;
const MAX_RELATED_PRS = 5;
const MAX_RECENT_COMMITS = 8;
/** Commit-message title matching is skipped for very short titles (too noisy). */
const MIN_TITLE_LENGTH_FOR_COMMIT_MATCH = 5;

export interface RelatedIssue {
  number: number;
  title: string;
  state: string;
  snippet: string;
}

export interface RelatedPullRequest {
  number: number;
  title: string;
  state: string;
  snippet: string;
}

export interface RelatedCommit {
  sha: string | undefined;
  message: string;
}

export interface EnrichedCatalogueNode extends CatalogueNode {
  relatedIssues: RelatedIssue[];
  relatedPRs: RelatedPullRequest[];
  recentCommits: RelatedCommit[];
}

export interface EnrichedCatalogue {
  nodes: EnrichedCatalogueNode[];
  [key: string]: unknown;
}

export interface EnrichFromManifestSummary {
  issueCount: number;
  prCount: number;
  commitCount: number;
  totalNodes: number;
  nodesWithIssues: number;
  nodesWithPRs: number;
  nodesWithCommits: number;
}

export interface EnrichFromManifestResult {
  catalogue: EnrichedCatalogue;
  summary: EnrichFromManifestSummary;
}

/** `path.basename(file).replace(/\.\w+$/, '')`, without a `node:path` dependency (keeps this module runtime-agnostic). */
function fileBaseName(file: string): string {
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  const base = slash >= 0 ? file.slice(slash + 1) : file;
  return base.replace(/\.\w+$/, '');
}

function snippetOf(body: string | null | undefined): string {
  return (body ?? '').substring(0, SNIPPET_LENGTH).replace(/\n/g, ' ');
}

/**
 * Attaches `relatedIssues` / `relatedPRs` / `recentCommits` to every
 * catalogue node by matching its file / title / id against the manifest's
 * issues, pull requests, and commits — matching `scripts/enrich-context.js`'s
 * matching rules and per-node caps exactly.
 */
export function enrichFromManifest(catalogue: Catalogue, manifest: RepoManifest): EnrichFromManifestResult {
  const issues = manifest.issues ?? [];
  const prs = manifest.pullRequests ?? [];
  const commits = manifest.commits ?? [];

  const enrichedNodes: EnrichedCatalogueNode[] = (catalogue.nodes ?? []).map((node): EnrichedCatalogueNode => {
    const file = node.file ?? '';
    const fileBase = fileBaseName(file);
    const titleLower = (node.title ?? '').toLowerCase();
    const idLower = (node.id ?? '').toLowerCase();

    const relatedIssues: RelatedIssue[] = [];
    for (const iss of issues) {
      const body = (iss.body ?? '').toLowerCase();
      const title = (iss.title ?? '').toLowerCase();
      if (
        (file && (body.includes(file) || body.includes(fileBase))) ||
        (titleLower && (body.includes(titleLower) || title.includes(titleLower))) ||
        (idLower && body.includes(idLower))
      ) {
        relatedIssues.push({ number: iss.number, title: iss.title, state: iss.state, snippet: snippetOf(iss.body) });
      }
    }

    const relatedPRs: RelatedPullRequest[] = [];
    for (const pr of prs) {
      const body = (pr.body ?? '').toLowerCase();
      const title = (pr.title ?? '').toLowerCase();
      if (
        (file && (body.includes(file) || body.includes(fileBase))) ||
        (titleLower && (body.includes(titleLower) || title.includes(titleLower)))
      ) {
        relatedPRs.push({ number: pr.number, title: pr.title, state: pr.state, snippet: snippetOf(pr.body) });
      }
    }

    const recentCommits: RelatedCommit[] = [];
    for (const c of commits) {
      const msg = (c.commit?.message ?? '').toLowerCase();
      if (
        (file && msg.includes(fileBase)) ||
        (titleLower.length > MIN_TITLE_LENGTH_FOR_COMMIT_MATCH && msg.includes(titleLower))
      ) {
        recentCommits.push({ sha: c.sha?.substring(0, 7), message: c.commit?.message?.split('\n')[0] ?? '' });
      }
    }

    return {
      ...node,
      relatedIssues: relatedIssues.slice(0, MAX_RELATED_ISSUES),
      relatedPRs: relatedPRs.slice(0, MAX_RELATED_PRS),
      recentCommits: recentCommits.slice(0, MAX_RECENT_COMMITS),
    };
  });

  let nodesWithIssues = 0;
  let nodesWithPRs = 0;
  let nodesWithCommits = 0;
  for (const n of enrichedNodes) {
    if (n.relatedIssues.length > 0) nodesWithIssues++;
    if (n.relatedPRs.length > 0) nodesWithPRs++;
    if (n.recentCommits.length > 0) nodesWithCommits++;
  }

  return {
    catalogue: { ...catalogue, nodes: enrichedNodes },
    summary: {
      issueCount: issues.length,
      prCount: prs.length,
      commitCount: commits.length,
      totalNodes: enrichedNodes.length,
      nodesWithIssues,
      nodesWithPRs,
      nodesWithCommits,
    },
  };
}
