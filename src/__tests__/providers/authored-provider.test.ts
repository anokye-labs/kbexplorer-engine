import { describe, it, expect } from 'vitest';
import { AuthoredProvider } from '../../providers/authored-provider';
import type { KBConfig } from '../../../types';
import { DEFAULT_CONFIG } from '../../../types';

const config: KBConfig = DEFAULT_CONFIG;

const sampleMarkdown = `---
id: intro
title: Introduction
emoji: "📘"
cluster: docs
---

# Introduction

Welcome to kbexplorer.`;

describe('AuthoredProvider', () => {
  it('parses authored markdown content into nodes', async () => {
    const provider = new AuthoredProvider({ 'content/intro.md': sampleMarkdown });
    const { nodes } = await provider.resolve(config, []);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('intro');
    expect(nodes[0].title).toBe('Introduction');
    expect(nodes[0].cluster).toBe('docs');
    expect(nodes[0].content).toContain('<h1>');
  });

  it('tags nodes with provider: authored', async () => {
    const provider = new AuthoredProvider({ 'content/intro.md': sampleMarkdown });
    const { nodes } = await provider.resolve(config, []);

    for (const node of nodes) {
      expect(node.provider).toBe('authored');
    }
  });

  it('assigns urn:content: identity', async () => {
    const provider = new AuthoredProvider({ 'content/intro.md': sampleMarkdown });
    const { nodes } = await provider.resolve(config, []);

    expect(nodes[0].identity).toBe('urn:content:intro');
  });

  it('processes nodemap entries when provided', async () => {
    const nodemapYaml = `nodes:
  - id: config-file
    title: Config
    file: vite.config.ts
    cluster: code
    emoji: Settings`;
    const nodemapFiles: Record<string, string> = {
      'vite.config.ts': '// vite config content',
    };

    const provider = new AuthoredProvider({}, nodemapYaml, nodemapFiles);
    const { nodes } = await provider.resolve(config, []);

    expect(nodes.length).toBeGreaterThan(0);
    const configNode = nodes.find(n => n.id === 'config-file');
    expect(configNode).toBeDefined();
    expect(configNode!.provider).toBe('authored');
  });

  it('handles empty content gracefully', async () => {
    const provider = new AuthoredProvider({});
    const { nodes, edges } = await provider.resolve(config, []);

    expect(nodes).toHaveLength(0);
    expect(edges).toEqual([]);
  });

  it('handles missing nodemap gracefully', async () => {
    const provider = new AuthoredProvider(
      { 'content/page.md': sampleMarkdown },
      null,
    );
    const { nodes } = await provider.resolve(config, []);

    // Should still parse the authored content
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0].id).toBe('intro');
  });
});
