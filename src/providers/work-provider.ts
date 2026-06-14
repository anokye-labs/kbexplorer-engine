/**
 * WorkProvider — wraps existing issue / PR / commit logic into a GraphProvider.
 *
 * Produces nodes for GitHub issues, pull requests, and commits, tagging each
 * with `provider: 'work'` and a canonical identity URN.
 */
import { marked } from 'marked';
import type { GraphProvider, ProviderResult } from '../providers';
import type { Connection, KBConfig, KBNode } from '../../types';
import { issueToNode, extractIssueRefs } from '../parser';
import { assignIdentity } from '../identity';
import type { GHIssue, GHRelease } from '../../api';

type WorkPullRequest = {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: Array<{ name: string; color: string }>;
  html_url: string;
  created_at: string;
  updated_at: string;
  head_branch?: string;
  /** GitHub user who opened the pull request. */
  user?: { login: string };
};

type WorkCommit = {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
  html_url: string;
};

type WorkRepoMetadata = {
  name: string;
  description: string;
  html_url: string;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  private: boolean;
  topics: string[];
  primary_language: string;
  languages: Array<{ name: string; size: number }>;
  owner: { login: string; avatar_url: string };
};

export class WorkProvider implements GraphProvider {
  id = 'work';
  name = 'Work Items';
  dependencies: string[] = [];

  private issues: GHIssue[];
  private pullRequests: WorkPullRequest[];
  private commits: WorkCommit[];
  private branches: Array<{ name: string; protected: boolean }>;
  private repoMetadata: WorkRepoMetadata | null;
  private releases: GHRelease[];

  constructor(
    issues: GHIssue[],
    pullRequests: WorkPullRequest[],
    commits: WorkCommit[],
    branches: Array<{ name: string; protected: boolean }> = [],
    repoMetadata: WorkRepoMetadata | null = null,
    releases: GHRelease[] = [],
  ) {
    this.issues = issues;
    this.pullRequests = pullRequests;
    this.commits = commits;
    this.branches = branches;
    this.repoMetadata = repoMetadata;
    this.releases = releases;
  }

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    const nodes: KBNode[] = [];

    // Pre-compute the valid issue/PR sets so we can filter phantom #NNN refs
    // (without this, every #NNN in a body produces an edge even if the target
    // issue/PR doesn't exist — hundreds of dangling edges per repo).
    const knownIssueNumbers = new Set(this.issues.map(i => i.number));
    const knownPrNumbers = new Set(this.pullRequests.map(p => p.number));
    const repoNodeId = this.repoMetadata ? 'repo-meta' : undefined;

    // Issues — reuse the shared parser helper
    for (const issue of this.issues) {
      const node = issueToNode(issue, {
        knownIssueNumbers,
        knownPrNumbers,
        repoNodeId,
      });
      node.provider = 'work';
      node.identity = assignIdentity(node);
      nodes.push(node);
    }

    // Pull requests
    for (const pr of this.pullRequests) {
      const body = pr.body ?? '';

      // Remap GitHub links to graph node links
      const remappedBody = body
        .replace(/https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/g, (_m: string, num: string) => `issue-${num}`)
        .replace(/https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/g, (_m: string, num: string) => `pr-${num}`)

      const refs = extractIssueRefs(body);

      // Rich metadata header
      const stateEmoji = pr.state === 'open' ? '🟢' : pr.state === 'merged' ? '🟣' : '🔴';
      const labelBadges = pr.labels?.map(l => `\`${l.name}\``).join(' ') ?? '';
      const created = new Date(pr.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const updated = new Date(pr.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      const metaLines = [
        `${stateEmoji} **${(pr.state || 'closed').toUpperCase()}** · PR #${pr.number}`,
        labelBadges ? `Labels: ${labelBadges}` : '',
        `Created: ${created} · Updated: ${updated}`,
        `[View on GitHub ↗](${pr.html_url})`,
      ].filter(Boolean).join('\n\n');

      const fullContent = `${metaLines}\n\n---\n\n${remappedBody}`;
      const html = marked.parse(fullContent, { async: false }) as string;

      // Build connections — filter out phantom #NNN refs to nonexistent
      // issues/PRs. Most #NNN in PR bodies are issues; fall back to PR if it's
      // a real PR number. Skip self-references.
      const connections: Connection[] = [];
      const seen = new Set<string>();
      for (const n of refs) {
        if (n === pr.number) continue;
        if (knownIssueNumbers.has(n)) {
          const to = `issue-${n}`;
          if (!seen.has(to)) {
            connections.push({ to, description: `References #${n}` });
            seen.add(to);
          }
        } else if (knownPrNumbers.has(n)) {
          const to = `pr-${n}`;
          if (!seen.has(to)) {
            connections.push({ to, description: `References #${n}` });
            seen.add(to);
          }
        }
      }

      // PR → branch connection
      if (pr.head_branch) {
        connections.push({ to: `branch-${pr.head_branch}`, description: `Branch: ${pr.head_branch}` });
      }

      // PR → repository — every PR is tracked in the repo. This is what makes
      // repo-meta the actual hub of the work graph instead of a floating node.
      if (repoNodeId) {
        connections.push({
          to: repoNodeId,
          type: 'contains',
          relation: 'tracked-in',
          description: 'Tracked in repository',
          source: 'inferred',
        });
      }

      const prNode: KBNode = {
        id: `pr-${pr.number}`,
        title: pr.title,
        cluster: 'work',
        content: html,
        rawContent: fullContent,
        emoji: 'BranchFork',
        connections,
        source: { type: 'pull_request', number: pr.number, state: pr.state },
        provider: 'work',
      };
      if (repoNodeId) prNode.parent = repoNodeId;
      prNode.identity = assignIdentity(prNode);
      nodes.push(prNode);
    }

    // Commits (grouped into a single summary node)
    if (this.commits.length > 0) {
      const commitList = this.commits
        .slice(0, 30)
        .map(c => {
          const msg = c.commit.message.split('\n')[0];
          const date = new Date(c.commit.author.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const refs = extractIssueRefs(c.commit.message);
          const refLinks = refs.map(n => `[#${n}](issue-${n})`).join(' ');
          return `- \`${c.sha.substring(0, 7)}\` ${msg}${refLinks ? ' — ' + refLinks : ''} *(${date})*`;
        })
        .join('\n');

      // Extract issue refs from all commit messages for connections — filter
      // to refs that resolve to a real issue or PR.
      const commitConnections: Connection[] = [];
      const seenRefs = new Set<string>();
      for (const c of this.commits) {
        for (const n of extractIssueRefs(c.commit.message)) {
          if (knownIssueNumbers.has(n)) {
            const to = `issue-${n}`;
            if (!seenRefs.has(to)) {
              commitConnections.push({ to, description: `Commit references #${n}` });
              seenRefs.add(to);
            }
          } else if (knownPrNumbers.has(n)) {
            const to = `pr-${n}`;
            if (!seenRefs.has(to)) {
              commitConnections.push({ to, description: `Commit references #${n}` });
              seenRefs.add(to);
            }
          }
        }
      }
      // Commits roll up into the repository node.
      if (repoNodeId) {
        commitConnections.push({
          to: repoNodeId,
          type: 'contains',
          relation: 'tracked-in',
          description: 'Commits in repository',
          source: 'inferred',
        });
      }

      const commitContent = `## Recent Commits\n\n${this.commits.length} commits · ${this.commits[0]?.commit.author.name ?? 'unknown'}\n\n${commitList}`;
      const commitHtml = marked.parse(commitContent, { async: false }) as string;
      nodes.push({
        id: 'commits',
        title: 'Recent Commits',
        cluster: 'work',
        content: commitHtml,
        rawContent: commitContent,
        emoji: 'History',
        connections: commitConnections,
        source: { type: 'commit', sha: 'summary' },
        provider: 'work',
        ...(repoNodeId ? { parent: repoNodeId } : {}),
      });
    }

    // ── Repository node ──────────────────────────────────
    if (this.repoMetadata) {
      const meta = this.repoMetadata;
      const langList = meta.languages
        .sort((a, b) => b.size - a.size)
        .slice(0, 10)
        .map(l => `- **${l.name}** (${Math.round(l.size / 1024)}KB)`)
        .join('\n');
      const topicBadges = meta.topics.map(t => `\`${t}\``).join(' ');

      const repoContent = [
        `${meta.private ? '🔒 Private' : '🌐 Public'} · ⭐ ${meta.stargazers_count} · 🍴 ${meta.forks_count}`,
        meta.description ? `\n${meta.description}` : '',
        topicBadges ? `\n\nTopics: ${topicBadges}` : '',
        `\n\n## Languages\n\n${langList || 'No language data'}`,
        `\n\nDefault branch: \`${meta.default_branch}\``,
        `\n\n[View on GitHub ↗](${meta.html_url})`,
      ].join('');

      const repoHtml = marked.parse(repoContent, { async: false }) as string;
      const repoConns: Connection[] = [
        { to: 'readme', description: 'README' },
        { to: `branch-${meta.default_branch}`, description: `Default branch` },
        // Tie the GitHub-side repo node to the file-tree root so the source
        // tree and the repository are one navigable cluster (the two nodes
        // describe the same repo; without this they float independently).
        { to: 'repo-root', description: 'Source tree', type: 'contains', source: 'inferred' },
      ];

      nodes.push({
        id: 'repo-meta',
        title: meta.name,
        cluster: 'infra',
        content: repoHtml,
        rawContent: repoContent,
        emoji: 'Organization',
        display: 'repository',
        image: meta.owner.avatar_url || undefined,
        connections: repoConns,
        source: { type: 'repository', owner: meta.owner.login, repo: meta.name },
        provider: 'work',
      });
    }

    // ── Branch nodes ─────────────────────────────────────
    for (const branch of this.branches) {
      const protectedBadge = branch.protected ? '🛡️ Protected' : '';
      const isDefault = this.repoMetadata?.default_branch === branch.name;
      const branchContent = [
        `${isDefault ? '**Default branch**' : 'Branch'} · \`${branch.name}\``,
        protectedBadge ? ` · ${protectedBadge}` : '',
      ].join('');

      const branchHtml = marked.parse(branchContent, { async: false }) as string;
      // Every branch belongs to the repository — not just the default branch.
      // The previous behavior (default-only) left ~18 branches as orphans that
      // got force-attached to whatever the highest-degree node happened to be.
      const branchConns: Connection[] = [];
      if (repoNodeId) {
        branchConns.push({
          to: repoNodeId,
          type: 'contains',
          relation: 'tracked-in',
          description: isDefault ? 'Default branch of repository' : 'Branch in repository',
          source: 'inferred',
        });
      }

      nodes.push({
        id: `branch-${branch.name}`,
        title: branch.name,
        // Branches are a structural property of the repository — keep them in
        // the same cluster so the legend doesn't split branch-isms (the old
        // code put default in `infra` and the rest in `pull-request` which was
        // visually inconsistent).
        cluster: 'infra',
        content: branchHtml,
        rawContent: branchContent,
        emoji: branch.protected ? 'ShieldCheckmark' : 'Branch',
        connections: branchConns,
        source: { type: 'branch', name: branch.name, protected: branch.protected },
        provider: 'work',
        ...(repoNodeId ? { parent: repoNodeId } : {}),
      });
    }

    // ── Release nodes ─────────────────────────────────────
    for (const release of this.releases) {
      const tag = release.tag_name;
      const body = release.body ?? '';

      // Build rich metadata header
      const prereleaseBadge = release.prerelease ? '🔶 **PRE-RELEASE**' : '🟢 **RELEASE**';
      const pubDate = release.published_at
        ? new Date(release.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';

      const metaLines = [
        `${prereleaseBadge} · \`${tag}\``,
        pubDate ? `Published: ${pubDate}` : '',
        `[View on GitHub ↗](${release.html_url})`,
      ].filter(Boolean).join('\n\n');

      const fullContent = `${metaLines}\n\n---\n\n${body}`;
      const html = marked.parse(fullContent, { async: false }) as string;

      // Connections: release → repo node
      const connections: Connection[] = [];
      if (this.repoMetadata) {
        connections.push({ to: 'repo-meta', description: 'Repository', type: 'contains' });
      }

      // Connections: release → referenced PRs/issues (#N in release notes).
      // Filter to refs that resolve to a real PR or issue so we don't emit
      // edges to nonexistent nodes (was producing dozens of phantom edges per
      // release that the orphan-rescue would then "fix" with weak edges).
      const refs = extractIssueRefs(body);
      const seenRefs = new Set<string>();
      for (const n of refs) {
        if (knownPrNumbers.has(n)) {
          const prTo = `pr-${n}`;
          if (!seenRefs.has(prTo)) {
            connections.push({ to: prTo, description: `Ships PR #${n}`, type: 'ships' });
            seenRefs.add(prTo);
          }
        } else if (knownIssueNumbers.has(n)) {
          const issueTo = `issue-${n}`;
          if (!seenRefs.has(issueTo)) {
            connections.push({ to: issueTo, description: `Closes #${n}`, type: 'closes' });
            seenRefs.add(issueTo);
          }
        }
      }

      const releaseNode: KBNode = {
        id: `release-${tag}`,
        title: release.name || tag,
        cluster: 'work',
        content: html,
        rawContent: fullContent,
        emoji: release.prerelease ? 'Beaker' : 'Rocket',
        connections,
        source: { type: 'release', tag, prerelease: release.prerelease },
        provider: 'work',
        data: {
          tag_name: tag,
          html_url: release.html_url,
          published_at: release.published_at,
          prerelease: release.prerelease,
        },
      };
      releaseNode.identity = assignIdentity(releaseNode);
      nodes.push(releaseNode);
    }

    return { nodes, edges: [] };
  }
}
