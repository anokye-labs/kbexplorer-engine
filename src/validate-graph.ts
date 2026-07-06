/**
 * `validateGraph` — structural integrity checks over the engine's
 * authored-content graph (`content/*.md` + `config.yaml` + `nodemap.yaml`),
 * ported faithfully from kbexplorer-template's `scripts/validate-graph.js`
 * (anokye-labs/kbexplorer-engine#18, epic anokye-labs/kbexplorer-template#463).
 *
 * See `./graph-analysis-shared` for why this walks the narrow inline-link
 * graph directly instead of the fully-computed `KBGraph` from `buildGraph`.
 *
 * Input shape deliberately mirrors a `RepoManifest` slice: `buildManifest`
 * already produces `authoredContent` / `configRaw` / `nodemapRaw` / `tree` /
 * `issues` in exactly the shape the template script reads them (content
 * files, `content/config.yaml`, root `nodemap.yaml`, the repo tree, and
 * GitHub issues), so a caller holding a manifest can pass it straight
 * through, and a caller without one (e.g. local dev with no GitHub data
 * fetched yet) can supply just the pieces it has.
 */
import yaml from 'yaml';
import type { RepoManifest } from './sources/repo-manifest';
import type { NodeMap } from './nodemap';
import { parseAuthoredEntries, parseConfigClusters } from './graph-analysis-shared';

/** Inputs `validateGraph` needs — a subset of the fields `buildManifest` already produces. */
export type GraphValidationInput = Pick<RepoManifest, 'authoredContent'> &
  Partial<Pick<RepoManifest, 'configRaw' | 'nodemapRaw' | 'tree' | 'issues'>>;

export type ValidationSeverity = 'error' | 'warning';

export type ValidationRule =
  | 'broken-inline-link'
  | 'missing-github-link'
  | 'duplicate-id'
  | 'orphan-node'
  | 'invalid-cluster'
  | 'missing-nodemap-path'
  | 'empty-content';

/** One structural finding. `severity: 'error'` gates a caller (exit non-zero); `'warning'` does not. */
export interface ValidationFinding {
  rule: ValidationRule;
  severity: ValidationSeverity;
  message: string;
  nodeId?: string;
  target?: string;
}

export interface GraphValidationResult {
  /** `true` iff there are zero errors — mirrors the script's `process.exit(errors > 0 ? 1 : 0)`. Warnings never fail the gate. */
  ok: boolean;
  errorCount: number;
  warningCount: number;
  findings: ValidationFinding[];
  summary: {
    contentCount: number;
    issueCount: number;
  };
}

/** Parse the raw `nodemap.yaml` text, tolerating malformed/missing YAML. */
function parseNodemap(raw: string): NodeMap | null {
  try {
    return (yaml.parse(raw) as NodeMap) ?? null;
  } catch {
    return null;
  }
}

/**
 * Validate structural integrity of the authored-content graph: dangling
 * inline links, duplicate/orphan node ids, invalid cluster assignments,
 * nodemap.yaml path integrity, and empty content bodies. Non-gating callers
 * can ignore `ok`/`errorCount`; a gating CLI should exit non-zero when
 * `!result.ok`.
 */
export function validateGraph(input: GraphValidationInput): GraphValidationResult {
  const entries = parseAuthoredEntries(input.authoredContent);
  const definedClusters = new Set(Object.keys(parseConfigClusters(input.configRaw)));
  const issueCount = input.issues?.length ?? 0;

  const nodeIds = new Set(entries.map(e => e.id));
  const findings: ValidationFinding[] = [];

  // Rule 1: no broken inline links (issue-*/pr-* links are demoted to a
  // warning when no GitHub data is available yet, matching the script's
  // `issueCount === 0` relaxation).
  for (const entry of entries) {
    for (const target of entry.links) {
      if (nodeIds.has(target)) continue;
      const isGithubRef = target.startsWith('issue-') || target.startsWith('pr-');
      if (isGithubRef && issueCount === 0) {
        findings.push({
          rule: 'missing-github-link',
          severity: 'warning',
          message: `${entry.id} → ${target} (no GitHub data available)`,
          nodeId: entry.id,
          target,
        });
      } else {
        findings.push({
          rule: 'broken-inline-link',
          severity: 'error',
          message: `${entry.id} → ${target}`,
          nodeId: entry.id,
          target,
        });
      }
    }
  }

  // Rule 2: no duplicate node IDs.
  const idCounts = new Map<string, number>();
  for (const entry of entries) idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1);
  for (const [id, count] of idCounts) {
    if (count > 1) {
      findings.push({
        rule: 'duplicate-id',
        severity: 'error',
        message: `duplicate ID "${id}" (${count} files)`,
        nodeId: id,
      });
    }
  }

  // Rule 3: no orphan authored nodes (zero incoming inline links).
  const incomingCount = new Map<string, number>();
  for (const entry of entries) incomingCount.set(entry.id, 0);
  for (const entry of entries) {
    for (const target of entry.links) {
      if (incomingCount.has(target)) incomingCount.set(target, incomingCount.get(target)! + 1);
    }
  }
  for (const [id, count] of incomingCount) {
    if (count === 0) {
      findings.push({
        rule: 'orphan-node',
        severity: 'warning',
        message: `"${id}" has no incoming links`,
        nodeId: id,
      });
    }
  }

  // Rule 4: all cluster assignments must resolve to a config-defined cluster.
  for (const entry of entries) {
    if (entry.cluster && !definedClusters.has(entry.cluster)) {
      findings.push({
        rule: 'invalid-cluster',
        severity: 'error',
        message: `"${entry.id}" → cluster "${entry.cluster}"`,
        nodeId: entry.id,
        target: entry.cluster,
      });
    }
  }

  // Rule 5: nodemap.yaml identity consistency — every `file`/`directory`/
  // `files` entry must resolve to a real repo path. Skipped entirely when no
  // nodemap is supplied, matching the script's "no nodemap.yaml" skip.
  if (input.nodemapRaw) {
    const nodemap = parseNodemap(input.nodemapRaw);
    // A path is "known" if it appears in the supplied repo tree, or is one of
    // the authored content files themselves (which — by construction — exist,
    // since they were read to build `authoredContent`). This is a read-only
    // membership check, never a filesystem access, keeping the engine's root
    // surface runtime-agnostic.
    const knownPaths = new Set<string>(Object.keys(input.authoredContent));
    for (const item of input.tree ?? []) knownPaths.add(item.path);

    for (const node of nodemap?.nodes ?? []) {
      const candidates: string[] = [];
      if (node.file) candidates.push(node.file);
      if (node.directory) candidates.push(node.directory);
      if (node.files) candidates.push(...node.files);

      for (const path of candidates) {
        if (!knownPaths.has(path)) {
          findings.push({
            rule: 'missing-nodemap-path',
            severity: 'error',
            message: `"${node.id}" → ${path}`,
            nodeId: node.id,
            target: path,
          });
        }
      }
    }
  }

  // Rule 6: content quality — no empty body.
  for (const entry of entries) {
    if (!entry.body.trim()) {
      findings.push({
        rule: 'empty-content',
        severity: 'warning',
        message: `"${entry.id}" has empty content`,
        nodeId: entry.id,
      });
    }
  }

  const errorCount = findings.filter(f => f.severity === 'error').length;
  const warningCount = findings.filter(f => f.severity === 'warning').length;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    findings,
    summary: { contentCount: entries.length, issueCount },
  };
}
