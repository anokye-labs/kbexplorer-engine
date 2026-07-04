/**
 * Public `./sources` subpath — slice 3/5 of the kbexplorer-template ->
 * kbexplorer-engine migration (anokye-labs/kbexplorer-template#472, epic #463).
 *
 * `sources/repo-data.ts`'s real `RepoSource`/`RepoData`/`RepoPullRequest`/
 * `RepoMetadata` types superseded the placeholder `RepoSource` shape that
 * previously lived here (a scaffold stand-in with no real consumers, see
 * PR body for the slice-3 judgment call). `ManifestSource`/`GitHubApiSource`
 * remain placeholders: their real implementations are slice 4 scope.
 */
export class ManifestSource {}

export class GitHubApiSource {}

export type {
  RepoSource,
  RepoData,
  RepoPullRequest,
  RepoMetadata,
} from './sources/repo-data';
