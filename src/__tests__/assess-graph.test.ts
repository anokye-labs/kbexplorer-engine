/**
 * Unit tests for `assessGraph()` (anokye-labs/kbexplorer-engine#18) covering
 * branches the golden fixture in `./graph-analysis-golden.test.ts` doesn't
 * exercise: a passing `--gate` run, the oversized-cluster and high-out-
 * degree suggestion branches, the node/edge readability-limit suggestions,
 * and behavior with no `options.gate` requested.
 */
import { describe, it, expect } from 'vitest';
import { assessGraph } from '../assess-graph';

function md(id: string, cluster: string, title: string, body: string): string {
  return `---\nid: ${id}\ntitle: ${title}\ncluster: ${cluster}\n---\n\n${body}`;
}

describe('assessGraph', () => {
  it('omits `gate` entirely when options.gate is not requested', () => {
    const result = assessGraph({
      authoredContent: {
        'content/a.md': md('a', 'core', 'A', 'Links to [b](b).'),
        'content/b.md': md('b', 'core', 'B', 'Links to [a](a).'),
      },
    });
    expect(result.gate).toBeUndefined();
  });

  it('passes the gate when all five scores clear MIN_SCORES thresholds', () => {
    // A well-connected 8-node ring + long content clears connectivity,
    // density, bidirectionality, and content-depth thresholds; a single
    // cluster keeps clusterBalance at its 100 default.
    const longBody = 'x'.repeat(1200);
    const ids = Array.from({ length: 8 }, (_, i) => `n${i}`);
    const authoredContent: Record<string, string> = {};
    for (let i = 0; i < ids.length; i++) {
      const next = ids[(i + 1) % ids.length];
      const prev = ids[(i - 1 + ids.length) % ids.length];
      authoredContent[`content/${ids[i]}.md`] = md(
        ids[i]!,
        'core',
        `Node ${i}`,
        `${longBody} See [next](${next}) and [prev](${prev}).`,
      );
    }

    const result = assessGraph({ authoredContent }, { gate: true });
    expect(result.gate?.pass).toBe(true);
    expect(result.gate?.failures).toEqual([]);
  });

  it('suggests splitting an oversized cluster', () => {
    const authoredContent: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      authoredContent[`content/n${i}.md`] = md(`n${i}`, 'big', `N${i}`, 'Body.');
    }
    const result = assessGraph({ authoredContent });
    expect(result.suggestions.some(s => s.includes('consider splitting into sub-clusters'))).toBe(true);
  });

  it('suggests splitting a node with high out-degree', () => {
    const authoredContent: Record<string, string> = {
      'content/hub.md': md(
        'hub',
        'core',
        'Hub',
        Array.from({ length: 16 }, (_, i) => `[t${i}](t${i})`).join(' '),
      ),
    };
    for (let i = 0; i < 16; i++) {
      authoredContent[`content/t${i}.md`] = md(`t${i}`, 'core', `T${i}`, 'Body.');
    }
    const result = assessGraph({ authoredContent });
    expect(result.suggestions.some(s => s.includes('has 16 outgoing links'))).toBe(true);
  });

  it('suggests using layer views once node/edge readability limits are exceeded', () => {
    const authoredContent: Record<string, string> = {};
    for (let i = 0; i < 45; i++) {
      const next = `n${(i + 1) % 45}`;
      authoredContent[`content/n${i}.md`] = md(`n${i}`, 'core', `N${i}`, `[next](${next})`);
    }
    const result = assessGraph({ authoredContent });
    expect(result.suggestions.some(s => s.includes('Node count 45 exceeds 40-node readability limit'))).toBe(true);
  });

  it('handles an empty graph without throwing', () => {
    const result = assessGraph({ authoredContent: {} });
    expect(result.summary).toEqual({ nodeCount: 0, edgeCount: 0, clusterCount: 0 });
    expect(result.constraints.hubReachability.hubId).toBeNull();
    expect(result.scoreDetails.clusterBalanceApplicable).toBe(false);
    expect(result.scores.clusterBalance).toBe(100);
  });
});
