/**
 * Golden fixture parity test (anokye-labs/kbexplorer-engine#18 acceptance
 * criteria): asserts `validateGraph()`/`assessGraph()`, driven by the
 * engine's own `FileSystemSource` + `buildManifest()` pipeline over
 * `./fixtures/graph-analysis-repo`, reproduce kbexplorer-template's actual
 * `scripts/validate-graph.js` / `scripts/assess-graph.js` findings for the
 * exact same directory.
 *
 * `./fixtures/graph-analysis-golden.json` was captured by running the real
 * template scripts against this fixture directory (see the file's
 * `_comment` for methodology + exact commit SHAs); it is a committed
 * snapshot, not regenerated at test time, so this test has no network/CLI
 * dependency and no drift risk from template changes landing silently.
 *
 * The fixture was deliberately engineered to trip every rule in both
 * scripts at once: a dangling inline link, an `issue-*`/`pr-*` reference
 * (relaxed to a warning since no GitHub issues are supplied), a duplicate
 * node id (`dup1.md`/`dup2.md` both declare `id: dup`), two orphan nodes
 * (`gamma`, `empty`, plus the duplicate `dup`), an undefined cluster
 * (`gamma` → `bogus`), three invalid `nodemap.yaml` path shapes (`file`,
 * `directory`, and one bad entry inside a `files` list), and one
 * empty-bodied node (`empty`). See the golden JSON's own captured arrays
 * for the exact expected values.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileSystemSource } from '../sources/filesystem-source';
import { buildManifest } from '../sources/build-manifest';
import { validateGraph } from '../validate-graph';
import { assessGraph } from '../assess-graph';
import type { GraphValidationInput, ValidationFinding } from '../validate-graph';
import type { GraphAssessmentInput } from '../assess-graph';

const FIXTURE_ROOT = join(__dirname, 'fixtures', 'graph-analysis-repo');
const GOLDEN_PATH = join(__dirname, 'fixtures', 'graph-analysis-golden.json');

interface GoldenValidate {
  contentCount: number;
  issueCount: number;
  brokenLinks: Array<{ from: string; target: string }>;
  missingGhLinks: Array<{ from: string; target: string }>;
  duplicates: string[];
  orphans: string[];
  badClusters: Array<{ id: string; cluster: string }>;
  missingNodemapFiles: Array<{ id: string; file: string }>;
  emptyContent: string[];
  warnings: number;
  errors: number;
  exitCode: number;
}

interface GoldenAssess {
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  orphans: string[];
  hubId: string;
  maxHops: number;
  unreachable: string[];
  avgLinks: number;
  connectivityScore: number;
  clusterSizes: number[];
  clusterStdDev: number;
  clusterBalanceScore: number;
  density: number;
  densityScore: number;
  reciprocalCount: number;
  bidirPct: number;
  bidirScore: number;
  avgContentLen: number;
  depthScore: number;
  suggestions: string[];
  gatePass: boolean;
  gateFailures: Array<{ metric: string; actual: number; minimum: number }>;
}

async function loadInput(): Promise<GraphValidationInput & GraphAssessmentInput> {
  const configRaw = readFileSync(join(FIXTURE_ROOT, 'config.yaml'), 'utf8');
  const nodemapRaw = readFileSync(join(FIXTURE_ROOT, 'nodemap.yaml'), 'utf8');
  const source = new FileSystemSource(FIXTURE_ROOT, { repo: 'acme/graph-analysis-repo' });
  const manifest = await buildManifest(source, { configRaw, generatedAt: '2024-01-01T00:00:00.000Z' });
  return { ...manifest, nodemapRaw };
}

describe('validateGraph/assessGraph — golden parity with template scripts', () => {
  it('reproduces validate-graph.js findings exactly', async () => {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as { validate: GoldenValidate };
    const input = await loadInput();
    const result = validateGraph(input);

    expect(result.summary.contentCount).toBe(golden.validate.contentCount);
    expect(result.summary.issueCount).toBe(golden.validate.issueCount);
    expect(result.errorCount).toBe(golden.validate.errors);
    expect(result.warningCount).toBe(golden.validate.warnings);
    expect(result.ok).toBe(golden.validate.exitCode === 0);

    const byRule = <T,>(rule: string, map: (f: ValidationFinding) => T): T[] =>
      result.findings.filter(f => f.rule === rule).map(map);

    expect(byRule('broken-inline-link', f => ({ from: f.nodeId, target: f.target }))).toEqual(
      golden.validate.brokenLinks,
    );
    expect(byRule('missing-github-link', f => ({ from: f.nodeId, target: f.target }))).toEqual(
      golden.validate.missingGhLinks,
    );
    expect(byRule('duplicate-id', f => f.nodeId).sort()).toEqual([...golden.validate.duplicates].sort());
    expect(byRule('orphan-node', f => f.nodeId).sort()).toEqual([...golden.validate.orphans].sort());
    expect(byRule('invalid-cluster', f => ({ id: f.nodeId, cluster: f.target }))).toEqual(
      golden.validate.badClusters,
    );
    expect(byRule('missing-nodemap-path', f => ({ id: f.nodeId, file: f.target }))).toEqual(
      golden.validate.missingNodemapFiles,
    );
    expect(byRule('empty-content', f => f.nodeId)).toEqual(golden.validate.emptyContent);
  });

  it('reproduces assess-graph.js scores/suggestions/gate exactly', async () => {
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as { assess: GoldenAssess };
    const input = await loadInput();
    const result = assessGraph(input, { gate: true });

    expect(result.summary.nodeCount).toBe(golden.assess.nodeCount);
    expect(result.summary.edgeCount).toBe(golden.assess.edgeCount);
    expect(result.summary.clusterCount).toBe(golden.assess.clusterCount);

    expect(result.constraints.orphanNodes).toEqual(golden.assess.orphans);
    expect(result.constraints.hubReachability.hubId).toBe(golden.assess.hubId);
    expect(result.constraints.hubReachability.maxHops).toBe(golden.assess.maxHops);
    expect([...result.constraints.hubReachability.unreachable].sort()).toEqual(
      [...golden.assess.unreachable].sort(),
    );

    expect(result.scoreDetails.avgLinksPerNode).toBe(golden.assess.avgLinks);
    expect(result.scores.connectivity).toBe(golden.assess.connectivityScore);
    expect(result.scoreDetails.clusterSizes.slice().sort((a: number, b: number) => a - b)).toEqual(
      golden.assess.clusterSizes.slice().sort((a: number, b: number) => a - b),
    );
    expect(result.scoreDetails.clusterStdDev).toBe(golden.assess.clusterStdDev);
    expect(result.scores.clusterBalance).toBe(golden.assess.clusterBalanceScore);
    expect(result.scoreDetails.density).toBe(golden.assess.density);
    expect(result.scores.density).toBe(golden.assess.densityScore);
    expect(result.scoreDetails.bidirectionalPct).toBe(golden.assess.bidirPct);
    expect(result.scores.bidirectionality).toBe(golden.assess.bidirScore);
    expect(result.scoreDetails.avgContentLength).toBe(golden.assess.avgContentLen);
    expect(result.scores.contentDepth).toBe(golden.assess.depthScore);

    expect([...result.suggestions].sort()).toEqual([...golden.assess.suggestions].sort());

    expect(result.gate?.pass).toBe(golden.assess.gatePass);
    expect(
      [...(result.gate?.failures ?? [])].sort((a, b) => a.metric.localeCompare(b.metric)),
    ).toEqual([...golden.assess.gateFailures].sort((a, b) => a.metric.localeCompare(b.metric)));
  });
});
