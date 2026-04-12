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
      const html = marked.parse(body, { async: false }) as string;
      const refs = extractIssueRefs(body);
      const prNode: KBNode = {
        id: `pr-${pr.number}`,
        title: pr.title,
        cluster: 'pull-request',
        content: html,
        rawContent: body,
        emoji: 'BranchFork',
        connections: refs.map(n => ({
          to: `issue-${n}`,
          description: `References #${n}`,
        })),
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
        .map(c => `- \`${c.sha.substring(0, 7)}\` ${c.commit.message}`)
        .join('\n');
      const commitContent = `## Recent Commits\n\n${this.commits.length} commits\n\n${commitList}`;
      const commitHtml = marked.parse(commitContent, { async: false }) as string;
      nodes.push({
        id: 'commits',
        title: 'Recent Commits',
        cluster: 'commits',
        content: commitHtml,
        rawContent: commitContent,
        emoji: 'History',
        connections: [],
        source: { type: 'file', path: '.git/log' },
        provider: 'work',
      });
    }

    return { nodes, edges: [] };
  }
}
