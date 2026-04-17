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
    }>,
    private commits: Array<{
      sha: string;
      commit: { message: string; author: { name: string; date: string } };
      html_url: string;
    }>,
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

    return { nodes, edges: [] };
  }
}
