import { describe, it, expect } from 'vitest';
import { WorkProvider } from '../../providers/work-provider';
import type { GHIssue } from '../../../api';
import type { KBConfig } from '../../../types';
import { DEFAULT_CONFIG } from '../../../types';

const config: KBConfig = DEFAULT_CONFIG;

function makeIssue(overrides: Partial<GHIssue> = {}): GHIssue {
  return {
    number: 1,
    title: 'Test issue',
    body: 'Issue body text',
    state: 'open',
    labels: [{ name: 'bug', color: 'ff0000' }],
    assignees: [],
    html_url: 'https://github.com/test/repo/issues/1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    ...overrides,
  };
}

function makePR(number: number, body = '') {
  return {
    number,
    title: `PR #${number}`,
    body,
    state: 'open',
    labels: [] as Array<{ name: string; color: string }>,
    html_url: `https://github.com/test/repo/pull/${number}`,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  };
}

function makeCommit(sha: string, message: string) {
  return {
    sha,
    commit: { message, author: { name: 'Dev', date: '2024-01-01T00:00:00Z' } },
    html_url: `https://github.com/test/repo/commit/${sha}`,
  };
}

describe('WorkProvider', () => {
  it('creates issue nodes from GHIssue data', async () => {
    const issue = makeIssue({ number: 42, title: 'Fix crash on startup' });
    const provider = new WorkProvider([issue], [], []);
    const { nodes } = await provider.resolve(config, []);

    const issueNode = nodes.find(n => n.id === 'issue-42');
    expect(issueNode).toBeDefined();
    expect(issueNode!.title).toBe('Fix crash on startup');
    expect(issueNode!.cluster).toBe('bug');
  });

  it('creates PR nodes with cross-references', async () => {
    const pr = makePR(10, 'Fixes #42 and relates to #7');
    const provider = new WorkProvider([], [pr], []);
    const { nodes } = await provider.resolve(config, []);

    const prNode = nodes.find(n => n.id === 'pr-10');
    expect(prNode).toBeDefined();
    expect(prNode!.connections.some(c => c.to === 'issue-42')).toBe(true);
    expect(prNode!.connections.some(c => c.to === 'issue-7')).toBe(true);
  });

  it('creates commit summary node', async () => {
    const commits = [
      makeCommit('abc1234567890', 'Initial commit'),
      makeCommit('def4567890123', 'Add tests'),
    ];
    const provider = new WorkProvider([], [], commits);
    const { nodes } = await provider.resolve(config, []);

    const commitNode = nodes.find(n => n.id === 'commits');
    expect(commitNode).toBeDefined();
    expect(commitNode!.title).toBe('Recent Commits');
    expect(commitNode!.rawContent).toContain('abc1234');
    expect(commitNode!.rawContent).toContain('2 commits');
  });

  it('tags all nodes with provider: work', async () => {
    const provider = new WorkProvider(
      [makeIssue()],
      [makePR(5)],
      [makeCommit('aaa0000000000', 'msg')],
    );
    const { nodes } = await provider.resolve(config, []);

    for (const node of nodes) {
      expect(node.provider).toBe('work');
    }
  });

  it('assigns identity URNs (urn:issue:, urn:pr:)', async () => {
    const provider = new WorkProvider(
      [makeIssue({ number: 3 })],
      [makePR(7)],
      [],
    );
    const { nodes } = await provider.resolve(config, []);

    const issueNode = nodes.find(n => n.id === 'issue-3');
    expect(issueNode!.identity).toBe('urn:issue:3');

    const prNode = nodes.find(n => n.id === 'pr-7');
    expect(prNode!.identity).toBe('urn:pr:7');
  });

  it('handles empty arrays', async () => {
    const provider = new WorkProvider([], [], []);
    const { nodes, edges } = await provider.resolve(config, []);

    expect(nodes).toHaveLength(0);
    expect(edges).toEqual([]);
  });
});
