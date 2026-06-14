/**
 * PersonProvider — derives first-class person nodes from GitHub work data (#235).
 *
 * Materialization rules:
 *  - A GitHub login that appears as author OR assignee on ≥ `minActiveItems`
 *    OPEN (active) issues or PRs becomes a `person` node.
 *  - If a content-model person descriptor already exists with a matching
 *    `alias` field equal to the login, no duplicate is created. Instead the
 *    work-derived node is suppressed and the descriptor's identity URN is
 *    reused by emitting connection edges from that login to their active items.
 *    The descriptor node (from ContentModelProvider) is enriched with
 *    connections pointing to the active items.
 *  - Edges emitted:
 *      person → issue/PR  (relation: 'assigned-to' or 'authored')
 *      person → team      (when a content-model team descriptor lists the login
 *                          in its `members` array — future: via existing data)
 */
import { marked } from 'marked';
import type { GraphProvider, ProviderResult } from '../providers';
import type { KBConfig, KBNode, KBEdge, Connection } from '../../types';
import { assignIdentity } from '../identity';
import type { GHIssue } from '../../api';

type WorkPullRequestForPerson = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user?: { login: string };
  assignees?: Array<{ login: string }>;
};

export type PersonProviderPR = WorkPullRequestForPerson;

/** Minimum number of active items before a person node materializes. */
const DEFAULT_MIN_ACTIVE_ITEMS = 1;

interface PersonData {
  login: string;
  /** Assigned open issues */
  assignedIssues: GHIssue[];
  /** Authored open issues (user.login matches) */
  authoredIssues: GHIssue[];
  /** Assigned open PRs */
  assignedPRs: PersonProviderPR[];
  /** Authored open PRs */
  authoredPRs: PersonProviderPR[];
}

export class PersonProvider implements GraphProvider {
  id = 'person';
  name = 'People';
  /**
   * Run after work so we can match existing nodes; run after content-model
   * so we can link to descriptor people.
   */
  dependencies: string[] = ['work', 'content-model'];

  private issues: GHIssue[];
  private pullRequests: PersonProviderPR[];

  constructor(issues: GHIssue[], pullRequests: PersonProviderPR[]) {
    this.issues = issues;
    this.pullRequests = pullRequests;
  }

  async resolve(config: KBConfig, existingNodes: KBNode[]): Promise<ProviderResult> {
    const minActive = config.people?.minActiveItems ?? DEFAULT_MIN_ACTIVE_ITEMS;

    // ── 1. Collect active (open) items per login ──────────────
    const byLogin = new Map<string, PersonData>();

    function ensureLogin(login: string): PersonData {
      let d = byLogin.get(login);
      if (!d) {
        d = { login, assignedIssues: [], authoredIssues: [], assignedPRs: [], authoredPRs: [] };
        byLogin.set(login, d);
      }
      return d;
    }

    for (const issue of this.issues) {
      if (issue.state !== 'open') continue;
      for (const a of issue.assignees ?? []) {
        ensureLogin(a.login).assignedIssues.push(issue);
      }
      if (issue.user?.login) {
        ensureLogin(issue.user.login).authoredIssues.push(issue);
      }
    }

    for (const pr of this.pullRequests) {
      if (pr.state !== 'open') continue;
      for (const a of pr.assignees ?? []) {
        ensureLogin(a.login).assignedPRs.push(pr);
      }
      if (pr.user?.login) {
        ensureLogin(pr.user.login).authoredPRs.push(pr);
      }
    }

    // ── 2. Apply threshold ────────────────────────────────────
    const qualifying = [...byLogin.values()].filter(d => {
      const activeCount =
        d.assignedIssues.length +
        d.authoredIssues.length +
        d.assignedPRs.length +
        d.authoredPRs.length;
      return activeCount >= minActive;
    });

    if (qualifying.length === 0) return { nodes: [], edges: [] };

    // ── 3. Build an index of content-model person descriptors ─
    //   index: alias (login handle) → existing node
    const descriptorByAlias = new Map<string, KBNode>();
    for (const n of existingNodes) {
      if (n.entityType === 'person' || n.source.type === 'structured' && (n.source as { entityType: string }).entityType === 'person') {
        const alias = n.data?.alias as string | undefined;
        if (alias) descriptorByAlias.set(alias.toLowerCase(), n);
        // Also index by the descriptor's own `id` for completeness
        const descId = n.data?.id as string | undefined;
        if (descId) descriptorByAlias.set(descId.toLowerCase(), n);
      }
    }

    const nodes: KBNode[] = [];
    const edges: KBEdge[] = [];

    for (const d of qualifying) {
      const loginLower = d.login.toLowerCase();
      const descriptor = descriptorByAlias.get(loginLower);

      // Build connections (edges from person → active items)
      const connections: Connection[] = [];
      const seen = new Set<string>();

      const addConn = (to: string, relation: 'assigned-to' | 'authored') => {
        if (!seen.has(to)) {
          connections.push({
            to,
            relation,
            description: relation === 'assigned-to' ? 'Assigned to' : 'Authored',
            type: 'related',
            source: 'inferred',
          });
          seen.add(to);
        }
      };

      for (const issue of d.assignedIssues) addConn(`issue-${issue.number}`, 'assigned-to');
      for (const issue of d.authoredIssues) addConn(`issue-${issue.number}`, 'authored');
      for (const pr of d.assignedPRs) addConn(`pr-${pr.number}`, 'assigned-to');
      for (const pr of d.authoredPRs) addConn(`pr-${pr.number}`, 'authored');

      if (descriptor) {
        // Descriptor exists: enrich it with connections to active items AND
        // the active-work data bag PersonView renders its "Active work"
        // section from (data.activeIssues / data.activePRs).
        const uniqueIssuesD = [
          ...d.assignedIssues,
          ...d.authoredIssues.filter(i => !d.assignedIssues.some(a => a.number === i.number)),
        ];
        const uniquePRsD = [
          ...d.assignedPRs,
          ...d.authoredPRs.filter(pr => !d.assignedPRs.some(a => a.number === pr.number)),
        ];
        descriptor.data = {
          ...(descriptor.data ?? {}),
          login: d.login,
          activeIssues: uniqueIssuesD.map(i => ({ number: i.number, title: i.title })),
          activePRs: uniquePRsD.map(pr => ({ number: pr.number, title: pr.title })),
          activeIssueCount: uniqueIssuesD.length,
          activePRCount: uniquePRsD.length,
        };
        // Enrich it with connections to active items.
        // We push these connections onto the descriptor node so the graph
        // renders edges from the descriptor person to their active items.
        // (Safe: KBNode.connections is an array we can append to.)
        for (const conn of connections) {
          const alreadyPresent = descriptor.connections.some(c => c.to === conn.to);
          if (!alreadyPresent) descriptor.connections.push(conn);
        }
        // Emit KBEdge entries for the orchestrator's edge set
        for (const conn of connections) {
          edges.push({
            from: descriptor.id,
            to: conn.to,
            type: 'related',
            relation: conn.relation,
            description: conn.description ?? '',
            source: 'inferred',
            weight: 1.5,
          });
        }
        // No new node — descriptor is the canonical representation
        continue;
      }

      // ── No descriptor: mint a work-derived person node ────────
      // Deduplicated issue/PR lists (author OR assignee, deduped by number)
      const uniqueIssues = [
        ...d.assignedIssues,
        ...d.authoredIssues.filter(i => !d.assignedIssues.some(a => a.number === i.number)),
      ];
      const uniquePRs = [
        ...d.assignedPRs,
        ...d.authoredPRs.filter(p => !d.assignedPRs.some(a => a.number === p.number)),
      ];

      const issueLines = uniqueIssues.map(i =>
        `- [#${i.number}: ${i.title}](issue-${i.number}) *(issue)*`
      );
      const prLines = uniquePRs.map(p =>
        `- [#${p.number}: ${p.title}](pr-${p.number}) *(PR)*`
      );

      const allLines = [...issueLines, ...prLines];
      const rawContent = [
        `## @${d.login}`,
        '',
        `**GitHub login:** \`${d.login}\``,
        '',
        `### Active work (${allLines.length} item${allLines.length !== 1 ? 's' : ''})`,
        '',
        ...allLines,
      ].join('\n');
      const content = marked.parse(rawContent, { async: false }) as string;

      const nodeId = `person-${d.login}`;
      const personNode: KBNode = {
        id: nodeId,
        title: `@${d.login}`,
        cluster: 'work',
        content,
        rawContent,
        emoji: 'Person',
        display: 'entity',
        connections,
        source: { type: 'person', login: d.login, linked: false },
        provider: 'person',
        entityType: 'person',
        derived: true,
        data: {
          login: d.login,
          activeIssues: uniqueIssues.map(i => ({ number: i.number, title: i.title })),
          activePRs: uniquePRs.map(p => ({ number: p.number, title: p.title })),
          activeIssueCount: uniqueIssues.length,
          activePRCount: uniquePRs.length,
        },
      };
      personNode.identity = assignIdentity(personNode);

      nodes.push(personNode);

      // Emit KBEdge entries
      for (const conn of connections) {
        edges.push({
          from: nodeId,
          to: conn.to,
          type: 'related',
          relation: conn.relation,
          description: conn.description ?? '',
          source: 'inferred',
          weight: 1.5,
        });
      }
    }

    return { nodes, edges };
  }
}
