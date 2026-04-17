/**
 * WorkProvider — wraps existing issue / PR / commit logic into a GraphProvider.
 *
 * Produces nodes for GitHub issues, pull requests, and commits, tagging each
 * with `provider: 'work'` and a canonical identity URN.
 */
import { marked } from 'marked';
import type { GraphProvider, ProviderResult } from '../providers';
import type { KBConfig, KBNode } from '../../types';
import { issueToNode, extractIssueRefs } from '../parser';
import { assignIdentity } from '../identity';
import type { GHIssue } from '../../api';

export class WorkProvider implements GraphProvider {
  id = 'work';
  name = 'Work Items';
  dependencies: string[] = [];

  constructor(
    private issues: GHIssue[],
    private pullRequests: Array<{
      number: number;
      title: string;
      body: string;
      state: string;
      labels: Array<{ name: string; color: string }>;
      html_url: string;
      created_at: string;
      updated_at: string;
      head_branch?: string;
    }>,
    private commits: Array<{
      sha: string;
      commit: { message: string; author: { name: string; date: string } };
      html_url: string;
    }>,
    private branches: Array<{ name: string; protected: boolean }> = [],
    private repoMetadata: {
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
    } | null = null,
  ) {}

  async resolve(_config: KBConfig, _existingNodes: KBNode[]): Promise<ProviderResult> {
    const nodes: KBNode[] = [];

    // Issues — reuse the shared parser helper
    for (const issue of this.issues) {
      const node = issueToNode(issue);
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

      // Build connections
      const connections: Array<{ to: string; description: string }> = [];
      const seen = new Set<string>();
      for (const n of refs) {
        const to = `issue-${n}`;
        if (!seen.has(to)) {
          connections.push({ to, description: `References #${n}` });
          seen.add(to);
        }
      }

      // PR → branch connection
      if (pr.head_branch) {
        connections.push({ to: `branch-${pr.head_branch}`, description: `Branch: ${pr.head_branch}` });
      }

      const prNode: KBNode = {
        id: `pr-${pr.number}`,
        title: pr.title,
        cluster: 'pull-request',
        content: html,
        rawContent: fullContent,
        emoji: 'BranchFork',
        connections,
        source: { type: 'pull_request', number: pr.number, state: pr.state },
        provider: 'work',
      };
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

      // Extract issue refs from all commit messages for connections
      const commitConnections: Array<{ to: string; description: string }> = [];
      const seenRefs = new Set<string>();
      for (const c of this.commits) {
        for (const n of extractIssueRefs(c.commit.message)) {
          const to = `issue-${n}`;
          if (!seenRefs.has(to)) {
            commitConnections.push({ to, description: `Commit references #${n}` });
            seenRefs.add(to);
          }
        }
      }

      const commitContent = `## Recent Commits\n\n${this.commits.length} commits · ${this.commits[0]?.commit.author.name ?? 'unknown'}\n\n${commitList}`;
      const commitHtml = marked.parse(commitContent, { async: false }) as string;
      nodes.push({
        id: 'commits',
        title: 'Recent Commits',
        cluster: 'commits',
        content: commitHtml,
        rawContent: commitContent,
        emoji: 'History',
        connections: commitConnections,
        source: { type: 'commit', sha: 'summary' },
        provider: 'work',
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
      const repoConns: Array<{ to: string; description: string }> = [
        { to: 'readme', description: 'README' },
        { to: `branch-${meta.default_branch}`, description: `Default branch` },
      ];

      nodes.push({
        id: 'repo-meta',
        title: meta.name,
        cluster: 'infra',
        content: repoHtml,
        rawContent: repoContent,
        emoji: 'Organization',
        display: 'repository' as any,
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
      const branchConns: Array<{ to: string; description: string }> = [];
      if (isDefault) branchConns.push({ to: 'repo-meta', description: 'Repository' });

      nodes.push({
        id: `branch-${branch.name}`,
        title: branch.name,
        cluster: isDefault ? 'infra' : 'pull-request',
        content: branchHtml,
        rawContent: branchContent,
        emoji: branch.protected ? 'ShieldCheckmark' : 'Branch',
        connections: branchConns,
        source: { type: 'branch', name: branch.name, protected: branch.protected },
        provider: 'work',
      });
    }

    return { nodes, edges: [] };
  }
}
