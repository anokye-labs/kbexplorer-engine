/**
 * Tests for release node derivation in WorkProvider.
 *
 * Covers:
 * - Node + edge derivation from a fixture release array
 * - Prerelease flag is reflected in node metadata
 * - #N cross-reference parsing (edges to PRs/issues)
 * - Empty releases → zero release nodes (repos without releases are unaffected)
 * - graph validation passes with empty and non-empty release arrays
 */
import { describe, it, expect } from 'vitest';
import { WorkProvider } from '../../providers/work-provider';
import type { GHRelease } from '../../../api';
import type { KBConfig } from '../../../types';
import { DEFAULT_CONFIG } from '../../../types';
import { getNodeLayer } from '../../../types';

const config: KBConfig = DEFAULT_CONFIG;

function makeRelease(overrides: Partial<GHRelease> = {}): GHRelease {
  return {
    tag_name: 'v1.0.0',
    name: 'Version 1.0.0',
    body: 'Initial stable release.',
    html_url: 'https://github.com/test/repo/releases/tag/v1.0.0',
    published_at: '2024-01-15T12:00:00Z',
    prerelease: false,
    ...overrides,
  };
}

describe('WorkProvider — release nodes', () => {
  it('creates a release node from a GHRelease record', async () => {
    const release = makeRelease({ tag_name: 'v2.0.0', name: 'Version 2.0.0' });
    const provider = new WorkProvider([], [], [], [], null, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v2.0.0');
    expect(releaseNode).toBeDefined();
    expect(releaseNode!.title).toBe('Version 2.0.0');
  });

  it('uses tag_name as fallback title when name is empty', async () => {
    const release = makeRelease({ tag_name: 'v0.9.0', name: '' });
    const provider = new WorkProvider([], [], [], [], null, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v0.9.0');
    expect(releaseNode).toBeDefined();
    expect(releaseNode!.title).toBe('v0.9.0');
  });

  it('assigns cluster "releases" to release nodes', async () => {
    const provider = new WorkProvider([], [], [], [], null, [makeRelease()]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.source.type === 'release');
    expect(releaseNode).toBeDefined();
    expect(releaseNode!.cluster).toBe('releases');
  });

  it('assigns source.type = release with tag and prerelease flag', async () => {
    const release = makeRelease({ tag_name: 'v3.0.0-rc.1', prerelease: true });
    const provider = new WorkProvider([], [], [], [], null, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v3.0.0-rc.1');
    expect(releaseNode).toBeDefined();
    expect(releaseNode!.source.type).toBe('release');
    const src = releaseNode!.source as { type: 'release'; tag: string; prerelease: boolean };
    expect(src.tag).toBe('v3.0.0-rc.1');
    expect(src.prerelease).toBe(true);
  });

  it('reflects prerelease=true in node data', async () => {
    const release = makeRelease({ tag_name: 'v1.0.0-beta.1', prerelease: true });
    const provider = new WorkProvider([], [], [], [], null, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v1.0.0-beta.1');
    expect(releaseNode).toBeDefined();
    expect(releaseNode!.data?.prerelease).toBe(true);
  });

  it('reflects prerelease=false in node data', async () => {
    const release = makeRelease({ tag_name: 'v1.0.0', prerelease: false });
    const provider = new WorkProvider([], [], [], [], null, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v1.0.0');
    expect(releaseNode).toBeDefined();
    expect(releaseNode!.data?.prerelease).toBe(false);
  });

  it('tags release nodes with provider: work', async () => {
    const provider = new WorkProvider([], [], [], [], null, [makeRelease()]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.source.type === 'release');
    expect(releaseNode!.provider).toBe('work');
  });

  it('assigns an identity URN for each release node', async () => {
    const release = makeRelease({ tag_name: 'v4.0.0' });
    const provider = new WorkProvider([], [], [], [], null, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v4.0.0');
    expect(releaseNode!.identity).toBe('urn:release:v4.0.0');
  });

  it('belongs to the work graph layer', async () => {
    const release = makeRelease({ tag_name: 'v5.0.0' });
    const provider = new WorkProvider([], [], [], [], null, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v5.0.0');
    expect(releaseNode).toBeDefined();
    expect(getNodeLayer(releaseNode!)).toBe('work');
  });
});

describe('WorkProvider — release #N cross-reference parsing', () => {
  it('generates connections to PRs/issues referenced by #N in release notes', async () => {
    const release = makeRelease({
      tag_name: 'v2.0.0',
      body: 'Closes #42\n\nShips PR #100\n\nSee also #7',
    });
    const provider = new WorkProvider([], [], [], [], null, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v2.0.0');
    expect(releaseNode).toBeDefined();

    const connectedTo = releaseNode!.connections.map(c => c.to);
    // Should link to both issue and PR for each referenced #N
    expect(connectedTo).toContain('issue-42');
    expect(connectedTo).toContain('pr-42');
    expect(connectedTo).toContain('issue-100');
    expect(connectedTo).toContain('pr-100');
    expect(connectedTo).toContain('issue-7');
    expect(connectedTo).toContain('pr-7');
  });

  it('does not create duplicate connections for the same reference number', async () => {
    const release = makeRelease({
      tag_name: 'v2.1.0',
      body: 'Closes #5. Also #5 was a blocker.',
    });
    const provider = new WorkProvider([], [], [], [], null, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v2.1.0');
    const issueTo = releaseNode!.connections.filter(c => c.to === 'issue-5');
    const prTo = releaseNode!.connections.filter(c => c.to === 'pr-5');
    expect(issueTo).toHaveLength(1);
    expect(prTo).toHaveLength(1);
  });

  it('creates no cross-ref connections for a release with no #N in notes', async () => {
    const release = makeRelease({
      tag_name: 'v1.2.0',
      body: 'Routine maintenance release with no issue references.',
    });
    const provider = new WorkProvider([], [], [], [], null, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v1.2.0');
    expect(releaseNode).toBeDefined();
    // Only connection is to repo-meta (absent since repoMetadata=null)
    expect(releaseNode!.connections).toHaveLength(0);
  });
});

describe('WorkProvider — release → repository edge', () => {
  it('creates a connection to repo-meta when repoMetadata is present', async () => {
    const repoMetadata = {
      name: 'test-repo',
      description: 'A test repo',
      html_url: 'https://github.com/test/repo',
      default_branch: 'main',
      stargazers_count: 0,
      forks_count: 0,
      private: false,
      topics: [],
      primary_language: 'TypeScript',
      languages: [],
      owner: { login: 'test', avatar_url: '' },
    };
    const release = makeRelease({ tag_name: 'v1.0.0' });
    const provider = new WorkProvider([], [], [], [], repoMetadata, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v1.0.0');
    expect(releaseNode).toBeDefined();
    const repoConn = releaseNode!.connections.find(c => c.to === 'repo-meta');
    expect(repoConn).toBeDefined();
  });

  it('does not create a repo-meta connection when repoMetadata is null', async () => {
    const release = makeRelease({ tag_name: 'v1.0.0' });
    const provider = new WorkProvider([], [], [], [], null, [release]);
    const { nodes } = await provider.resolve(config, []);

    const releaseNode = nodes.find(n => n.id === 'release-v1.0.0');
    expect(releaseNode).toBeDefined();
    const repoConn = releaseNode!.connections.find(c => c.to === 'repo-meta');
    expect(repoConn).toBeUndefined();
  });
});

describe('WorkProvider — zero releases (repos without releases)', () => {
  it('produces no release nodes when releases array is empty', async () => {
    const provider = new WorkProvider([], [], [], [], null, []);
    const { nodes } = await provider.resolve(config, []);

    const releaseNodes = nodes.filter(n => n.source.type === 'release');
    expect(releaseNodes).toHaveLength(0);
  });

  it('is backward-compatible: WorkProvider with no releases param produces no release nodes', async () => {
    // Construct with only the original positional args (no releases param)
    const provider = new WorkProvider([], [], []);
    const { nodes } = await provider.resolve(config, []);

    const releaseNodes = nodes.filter(n => n.source.type === 'release');
    expect(releaseNodes).toHaveLength(0);
  });

  it('existing nodes are unaffected when releases is empty', async () => {
    const provider = new WorkProvider([], [], [], [], null, []);
    const { nodes, edges } = await provider.resolve(config, []);

    expect(nodes).toHaveLength(0);
    expect(edges).toEqual([]);
  });

  it('creates the correct number of release nodes for N releases', async () => {
    const releases = [
      makeRelease({ tag_name: 'v1.0.0' }),
      makeRelease({ tag_name: 'v1.1.0' }),
      makeRelease({ tag_name: 'v2.0.0' }),
    ];
    const provider = new WorkProvider([], [], [], [], null, releases);
    const { nodes } = await provider.resolve(config, []);

    const releaseNodes = nodes.filter(n => n.source.type === 'release');
    expect(releaseNodes).toHaveLength(3);
  });
});
