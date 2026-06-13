/**
 * Tests for PersonProvider — derivation of person nodes from GitHub work data.
 *
 * Covers:
 * - Person node materialized from an assignee on an open issue
 * - Person node materialized from an author (user.login) on an open issue
 * - Person node materialized from open PR assignee / author
 * - Closed issues / PRs are NOT counted toward threshold
 * - Threshold: login with < minActiveItems active items produces no node
 * - No duplicate when a content-model descriptor exists with matching alias
 *   (descriptor node receives connections to active items instead)
 * - Zero-people graphs: no active items → no person nodes
 * - Identity URN is `urn:person:<login>`
 * - Edges are emitted person → issue/PR with correct `relation` value
 */
import { describe, it, expect } from 'vitest';
import { PersonProvider } from '../../providers/person-provider';
import type { GHIssue } from '../../../api';
import type { KBConfig, KBNode } from '../../../types';
import { DEFAULT_CONFIG } from '../../../types';

const config: KBConfig = DEFAULT_CONFIG;

function makeIssue(overrides: Partial<GHIssue> & { userLogin?: string } = {}): GHIssue {
  const { userLogin, ...rest } = overrides;
  return {
    number: 1,
    title: 'Test issue',
    body: null,
    state: 'open',
    labels: [{ name: 'feature', color: '4A9CC8' }],
    assignees: [],
    user: userLogin ? { login: userLogin } : undefined,
    html_url: 'https://github.com/test/repo/issues/1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    ...rest,
  };
}

function makePR(overrides: { number?: number; state?: string; userLogin?: string; assignees?: Array<{ login: string }> } = {}) {
  return {
    number: overrides.number ?? 10,
    title: `PR #${overrides.number ?? 10}`,
    state: overrides.state ?? 'open',
    html_url: `https://github.com/test/repo/pull/${overrides.number ?? 10}`,
    user: overrides.userLogin ? { login: overrides.userLogin } : undefined,
    assignees: overrides.assignees ?? [],
  };
}

/** Build a minimal descriptor KBNode mimicking a content-model person node. */
function makeDescriptor(alias: string, id = alias): KBNode {
  return {
    id: `urn:people/${id}`,
    title: alias,
    cluster: 'person',
    content: '',
    rawContent: '',
    connections: [],
    source: { type: 'structured', entityType: 'person', ref: id },
    entityType: 'person',
    data: { id, alias, name: alias },
  };
}

describe('PersonProvider', () => {
  describe('derivation from open issues', () => {
    it('creates a person node for an assignee on an open issue', async () => {
      const issue = makeIssue({ number: 1, assignees: [{ login: 'adaops' }] });
      const provider = new PersonProvider([issue], []);
      const { nodes } = await provider.resolve(config, []);

      const personNode = nodes.find(n => n.id === 'person-adaops');
      expect(personNode).toBeDefined();
      expect(personNode!.source.type).toBe('person');
    });

    it('creates a person node for the author (user.login) of an open issue', async () => {
      const issue = makeIssue({ number: 2, userLogin: 'bendev' });
      const provider = new PersonProvider([issue], []);
      const { nodes } = await provider.resolve(config, []);

      expect(nodes.find(n => n.id === 'person-bendev')).toBeDefined();
    });

    it('ignores closed issues when computing active count', async () => {
      const openIssue = makeIssue({ number: 1, state: 'open', assignees: [{ login: 'closeduser' }] });
      const closedIssue = makeIssue({ number: 2, state: 'closed', assignees: [{ login: 'closeduser' }] });
      // minActiveItems default is 1 — the open issue alone qualifies
      const provider = new PersonProvider([openIssue, closedIssue], []);
      const { nodes } = await provider.resolve(config, []);

      expect(nodes.find(n => n.id === 'person-closeduser')).toBeDefined();
    });

    it('does NOT create a person node when all matching issues are closed', async () => {
      const closedIssue = makeIssue({ number: 3, state: 'closed', assignees: [{ login: 'driveby' }] });
      const provider = new PersonProvider([closedIssue], []);
      const { nodes } = await provider.resolve(config, []);

      expect(nodes.find(n => n.id === 'person-driveby')).toBeUndefined();
    });
  });

  describe('derivation from open PRs', () => {
    it('creates a person node for a PR assignee', async () => {
      const pr = makePR({ number: 5, assignees: [{ login: 'prassignee' }] });
      const provider = new PersonProvider([], [pr]);
      const { nodes } = await provider.resolve(config, []);

      expect(nodes.find(n => n.id === 'person-prassignee')).toBeDefined();
    });

    it('creates a person node for a PR author (user.login)', async () => {
      const pr = makePR({ number: 6, userLogin: 'prauthor' });
      const provider = new PersonProvider([], [pr]);
      const { nodes } = await provider.resolve(config, []);

      expect(nodes.find(n => n.id === 'person-prauthor')).toBeDefined();
    });

    it('ignores closed PRs', async () => {
      const closedPR = makePR({ number: 7, state: 'closed', userLogin: 'closedpr' });
      const provider = new PersonProvider([], [closedPR]);
      const { nodes } = await provider.resolve(config, []);

      expect(nodes.find(n => n.id === 'person-closedpr')).toBeUndefined();
    });
  });

  describe('threshold (minActiveItems)', () => {
    it('respects minActiveItems = 1 (default): single active item qualifies', async () => {
      const issue = makeIssue({ number: 1, assignees: [{ login: 'singleitem' }] });
      const provider = new PersonProvider([issue], []);
      const { nodes } = await provider.resolve(config, []);

      expect(nodes.find(n => n.id === 'person-singleitem')).toBeDefined();
    });

    it('respects minActiveItems = 2: login with only 1 active item is excluded', async () => {
      const issue = makeIssue({ number: 1, assignees: [{ login: 'driveby' }] });
      const provider = new PersonProvider([issue], []);
      const configWith2 = { ...config, people: { minActiveItems: 2 } };
      const { nodes } = await provider.resolve(configWith2, []);

      expect(nodes.find(n => n.id === 'person-driveby')).toBeUndefined();
    });

    it('respects minActiveItems = 2: login with 2+ items is included', async () => {
      const issue1 = makeIssue({ number: 1, assignees: [{ login: 'active' }] });
      const issue2 = makeIssue({ number: 2, assignees: [{ login: 'active' }] });
      const provider = new PersonProvider([issue1, issue2], []);
      const configWith2 = { ...config, people: { minActiveItems: 2 } };
      const { nodes } = await provider.resolve(configWith2, []);

      expect(nodes.find(n => n.id === 'person-active')).toBeDefined();
    });
  });

  describe('descriptor-linking (no duplicate)', () => {
    it('does NOT emit a new person node when a descriptor with matching alias exists', async () => {
      const issue = makeIssue({ number: 1, assignees: [{ login: 'aokonkwo' }] });
      const descriptor = makeDescriptor('aokonkwo', 'ada');
      const provider = new PersonProvider([issue], []);
      const { nodes } = await provider.resolve(config, [descriptor]);

      // No new node for login 'aokonkwo'
      expect(nodes.find(n => n.id === 'person-aokonkwo')).toBeUndefined();
    });

    it('enriches the descriptor node with connections to active items', async () => {
      const issue = makeIssue({ number: 5, assignees: [{ login: 'aokonkwo' }] });
      const descriptor = makeDescriptor('aokonkwo', 'ada');
      const provider = new PersonProvider([issue], []);
      await provider.resolve(config, [descriptor]);

      expect(descriptor.connections.some(c => c.to === 'issue-5')).toBe(true);
    });

    it('emits edges from the descriptor id to its active items', async () => {
      const issue = makeIssue({ number: 7, assignees: [{ login: 'bcarter' }] });
      const descriptor = makeDescriptor('bcarter', 'ben');
      const provider = new PersonProvider([issue], []);
      const { edges } = await provider.resolve(config, [descriptor]);

      const edge = edges.find(e => e.from === descriptor.id && e.to === 'issue-7');
      expect(edge).toBeDefined();
      expect(edge!.relation).toBe('assigned-to');
    });

    it('does not add duplicate connections to descriptor when resolve is called twice', async () => {
      const issue = makeIssue({ number: 3, assignees: [{ login: 'aokonkwo' }] });
      const descriptor = makeDescriptor('aokonkwo', 'ada');
      const provider = new PersonProvider([issue], []);
      await provider.resolve(config, [descriptor]);
      await provider.resolve(config, [descriptor]);

      const conns = descriptor.connections.filter(c => c.to === 'issue-3');
      // Should appear only once
      expect(conns).toHaveLength(1);
    });
  });

  describe('identity URNs', () => {
    it('assigns urn:person:<login> as identity URN', async () => {
      const issue = makeIssue({ number: 1, assignees: [{ login: 'testlogin' }] });
      const provider = new PersonProvider([issue], []);
      const { nodes } = await provider.resolve(config, []);

      const node = nodes.find(n => n.id === 'person-testlogin');
      expect(node!.identity).toBe('urn:person:testlogin');
    });
  });

  describe('edges', () => {
    it('emits a "assigned-to" edge from person to assigned issue', async () => {
      const issue = makeIssue({ number: 10, assignees: [{ login: 'worker' }] });
      const provider = new PersonProvider([issue], []);
      const { edges } = await provider.resolve(config, []);

      const edge = edges.find(e => e.from === 'person-worker' && e.to === 'issue-10');
      expect(edge).toBeDefined();
      expect(edge!.relation).toBe('assigned-to');
    });

    it('emits an "authored" edge from person to authored issue', async () => {
      const issue = makeIssue({ number: 11, userLogin: 'author' });
      const provider = new PersonProvider([issue], []);
      const { edges } = await provider.resolve(config, []);

      const edge = edges.find(e => e.from === 'person-author' && e.to === 'issue-11');
      expect(edge).toBeDefined();
      expect(edge!.relation).toBe('authored');
    });

    it('emits a "assigned-to" edge for assigned open PR', async () => {
      const pr = makePR({ number: 20, assignees: [{ login: 'prassignee' }] });
      const provider = new PersonProvider([], [pr]);
      const { edges } = await provider.resolve(config, []);

      const edge = edges.find(e => e.from === 'person-prassignee' && e.to === 'pr-20');
      expect(edge).toBeDefined();
      expect(edge!.relation).toBe('assigned-to');
    });
  });

  describe('zero-people graphs', () => {
    it('returns no nodes or edges when there are no open issues or PRs', async () => {
      const provider = new PersonProvider([], []);
      const { nodes, edges } = await provider.resolve(config, []);

      expect(nodes).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });

    it('returns no nodes when all issues are closed', async () => {
      const closedIssue = makeIssue({ state: 'closed' });
      const provider = new PersonProvider([closedIssue], []);
      const { nodes } = await provider.resolve(config, []);

      expect(nodes).toHaveLength(0);
    });
  });

  describe('data bag', () => {
    it('populates data.login with the GitHub login', async () => {
      const issue = makeIssue({ number: 1, assignees: [{ login: 'dataperson' }] });
      const provider = new PersonProvider([issue], []);
      const { nodes } = await provider.resolve(config, []);

      const node = nodes.find(n => n.id === 'person-dataperson');
      expect(node!.data?.login).toBe('dataperson');
    });

    it('populates data.activeIssues with the active issue list', async () => {
      const issue = makeIssue({ number: 42, title: 'Big feature', assignees: [{ login: 'researcher' }] });
      const provider = new PersonProvider([issue], []);
      const { nodes } = await provider.resolve(config, []);

      const node = nodes.find(n => n.id === 'person-researcher');
      const issues = node!.data?.activeIssues as Array<{ number: number; title: string }>;
      expect(issues).toHaveLength(1);
      expect(issues[0]).toEqual({ number: 42, title: 'Big feature' });
    });

    it('deduplicates: issue appears only once even if same login is both author and assignee', async () => {
      const issue = makeIssue({
        number: 99,
        userLogin: 'multihat',
        assignees: [{ login: 'multihat' }],
      });
      const provider = new PersonProvider([issue], []);
      const { nodes } = await provider.resolve(config, []);

      const node = nodes.find(n => n.id === 'person-multihat');
      const issues = node!.data?.activeIssues as Array<{ number: number }>;
      expect(issues).toHaveLength(1);
    });
  });

  describe('provider metadata', () => {
    it('tags person nodes with provider: person', async () => {
      const issue = makeIssue({ number: 1, assignees: [{ login: 'tagged' }] });
      const provider = new PersonProvider([issue], []);
      const { nodes } = await provider.resolve(config, []);

      const node = nodes.find(n => n.id === 'person-tagged');
      expect(node!.provider).toBe('person');
    });

    it('tags person nodes with entityType: person', async () => {
      const issue = makeIssue({ number: 1, assignees: [{ login: 'entitytag' }] });
      const provider = new PersonProvider([issue], []);
      const { nodes } = await provider.resolve(config, []);

      const node = nodes.find(n => n.id === 'person-entitytag');
      expect(node!.entityType).toBe('person');
    });

    it('places person nodes in the "person" cluster', async () => {
      const issue = makeIssue({ number: 1, assignees: [{ login: 'clustered' }] });
      const provider = new PersonProvider([issue], []);
      const { nodes } = await provider.resolve(config, []);

      const node = nodes.find(n => n.id === 'person-clustered');
      expect(node!.cluster).toBe('person');
    });
  });
});
