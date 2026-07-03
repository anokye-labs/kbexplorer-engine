export class ManifestSource {}

export class GitHubApiSource {}

export type RepoSource = {
  readonly kind: 'repo';
  readonly url: string;
  readonly fetch: typeof fetch;
};
