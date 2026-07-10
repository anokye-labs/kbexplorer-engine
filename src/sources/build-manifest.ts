/**
 * buildManifest() — the manifest PRODUCER (anokye-labs/kbexplorer-engine#17,
 * the anchor child of the thin-CLI/fat-engine epic
 * anokye-labs/kbexplorer-template#463).
 *
 * The engine already owned the manifest **consume** path — `ManifestSource`,
 * the `RepoSource` acquisition adapters (`GitHubApiSource`, `FileSystemSource`),
 * and the `RepoManifest` snapshot shape itself (`./repo-manifest`). What was
 * missing was the **producer**: something that turns a `RepoSource` into a
 * `RepoManifest`. That logic lived duplicated outside the engine, in
 * kbexplorer-template's `scripts/generate-manifest.js` and the CLI's
 * byte-parallel `src/lib/repo-manifest.ts` fork (flagged by cli#232).
 *
 * `buildManifest` closes that loop *without* re-implementing any fetching:
 * acquisition (GitHub REST calls, local filesystem walks) already lives on the
 * injected `RepoSource`. This function drives it through the existing
 * `getRepoData()` seam exactly once and re-shapes the normalized `RepoData`
 * bundle into the serializable `RepoManifest` snapshot — the mechanical,
 * source-agnostic half of what the template script does before it writes
 * `repo-manifest.json` to disk. It is deliberately the mirror image of
 * `ManifestSource.getRepoData()` (which maps `RepoManifest` → `RepoData`);
 * this maps `RepoData` → `RepoManifest`.
 *
 * Signature note (`buildManifest(source, options)`, not `(source, config)`):
 * every `RepoManifest` field this function assembles comes straight off
 * `RepoData` — none of them need a resolved `KBConfig`. The two fields a
 * `RepoSource` cannot uniformly supply are threaded in via `options` instead:
 *
 *  - `configRaw` — the raw (pre-YAML-parse) `config.yaml` text. `KBConfig`
 *    (what `GitHubApiSource.resolveConfig()` / a local `loadConfig()` caller
 *    would have) is already-parsed, so it can't round-trip back to source
 *    text. Callers already hold (or can cheaply obtain) the raw text — a local
 *    caller reads the same file `FileSystemSource` walks, and a remote caller
 *    already has the engine's exported `fetchFile` to hand — so this function
 *    accepts it rather than duplicating a second raw-fetch code path.
 *  - `generatedAt` — the snapshot timestamp. Defaults to
 *    `new Date().toISOString()` but is overridable so callers (and this
 *    package's own tests) can produce deterministic output for
 *    idempotency/`--check`-drift assertions, matching the issue's requirement
 *    that source-derived fields (everything *except* `generatedAt`/live
 *    GitHub state) be deterministic.
 *
 * `nodemapFiles`/`nodemapDirs` are passed through as-is from `RepoData` when a
 * source populates them (neither shipped `RepoSource` does yet — both leave
 * `nodemapRaw: null`, matching their existing, unchanged behavior — so
 * `buildManifest` carries whatever future sources supply without
 * re-implementing the template script's nodemap-collection logic itself,
 * which is out of this issue's scope: see the issue's "non-goals").
 */
import type { RepoData, RepoPullRequest, RepoSource } from './repo-data';
import type { RepoManifest } from './repo-manifest';

/** Options for fields `RepoData` cannot uniformly supply (see module docs). */
export interface BuildManifestOptions {
  /** Raw (pre-parse) `config.yaml` text to embed, or `null`/omitted when there is none. */
  configRaw?: string | null;
  /**
   * Overrides the snapshot timestamp. Defaults to `new Date().toISOString()`.
   * Pass a fixed value for deterministic/idempotency tests and `--check` drift
   * comparisons, which must ignore this volatile field regardless.
   */
  generatedAt?: string;
  /** When set, overlay the live-GitHub fields from this source onto the primary-source manifest (hybrid: local content + live augmentation). */
  augmentFrom?: RepoSource;
}

/** Drop the `RepoPullRequest`-only `user`/`assignees` fields the `RepoManifest` shape doesn't carry. */
function toManifestPullRequest(pr: RepoPullRequest): RepoManifest['pullRequests'][number] {
  const mapped: RepoManifest['pullRequests'][number] = {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state,
    labels: pr.labels,
    html_url: pr.html_url,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
  };
  if (pr.head_branch !== undefined) mapped.head_branch = pr.head_branch;
  return mapped;
}

/**
 * Drive `source.getRepoData()` once and assemble a `RepoManifest` snapshot
 * from the result — the producer half of the `ManifestSource` contract.
 */
export async function buildManifest(
  source: RepoSource,
  options: BuildManifestOptions = {},
): Promise<RepoManifest> {
  const data: RepoData = await source.getRepoData();

  const manifest: RepoManifest = {
    configRaw: options.configRaw ?? null,
    authoredContent: data.authoredContent,
    tree: data.tree,
    readme: data.readme,
    issues: data.issues,
    pullRequests: data.pullRequests.map(toManifestPullRequest),
    commits: data.commits,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  };

  // Optional fields are set only when the source actually supplied something —
  // this package enables `exactOptionalPropertyTypes`, and it keeps a manifest
  // built from a source with nothing to report (e.g. no releases) free of
  // noisy empty-array/null noise, mirroring how `ManifestSource` treats them
  // as absent-safe on the way back in.
  if (data.branches.length > 0) manifest.branches = data.branches;
  if (data.releases.length > 0) manifest.releases = data.releases;
  if (data.repoMetadata) manifest.repoMetadata = data.repoMetadata;
  if (data.nodemapRaw !== null) manifest.nodemapRaw = data.nodemapRaw;
  if (data.nodemapFiles !== undefined) manifest.nodemapFiles = data.nodemapFiles;
  if (data.nodemapDirs !== undefined) manifest.nodemapDirs = data.nodemapDirs;
  if (data.structuredNodeMapRaw !== null) manifest.structuredNodeMapRaw = data.structuredNodeMapRaw;
  if (Object.keys(data.structuralFiles).length > 0) manifest.structuralFiles = data.structuralFiles;
  if (data.contentModel) manifest.contentModel = data.contentModel;
  if (data.themeFileRaw) manifest.themeFileRaw = data.themeFileRaw;

  if (options.augmentFrom) {
    const live = await options.augmentFrom.getRepoData();
    manifest.issues = live.issues;
    manifest.pullRequests = live.pullRequests.map(toManifestPullRequest);
    manifest.commits = live.commits;
    if (live.repoMetadata !== null) manifest.repoMetadata = live.repoMetadata;
    if (live.branches.length > 0) manifest.branches = live.branches;
    if (live.releases.length > 0) manifest.releases = live.releases;
  }

  return manifest;
}
