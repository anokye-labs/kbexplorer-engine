import { describe, expect, it } from 'vitest';
import {
  diagramLanguageFromClassName,
  extractDiagramFence,
  getDiagramRenderPlan,
  isDiagramCodeLanguage,
  isLikelyMermaidSource,
} from '../diagram';

describe('diagram rendering helpers', () => {
  it('extracts fenced Mermaid source', () => {
    const parsed = extractDiagramFence('```mermaid\nflowchart TD\n  A --> B\n```');

    expect(parsed.language).toBe('mermaid');
    expect(parsed.source).toBe('flowchart TD\n  A --> B');
  });

  it('detects Mermaid diagrams after init directives', () => {
    expect(isLikelyMermaidSource("%%{init: {'theme':'dark'}}%%\nflowchart TD\nA --> B")).toBe(true);
  });

  it('plans Mermaid rendering for explicit and inferred Mermaid blocks', () => {
    expect(getDiagramRenderPlan('flowchart TD\nA --> B', 'mermaid')).toMatchObject({
      kind: 'mermaid',
      language: 'mermaid',
    });

    expect(getDiagramRenderPlan('```diagram\nflowchart TD\nA --> B\n```')).toMatchObject({
      kind: 'mermaid',
      language: 'mermaid',
    });
  });

  it('keeps unsupported diagram languages as visible source fallbacks', () => {
    const plan = getDiagramRenderPlan('@startuml\nA -> B\n@enduml', 'plantuml');

    expect(plan.kind).toBe('unsupported');
    if (plan.kind !== 'unsupported') throw new Error('Expected unsupported diagram plan');
    expect(plan.source).toContain('@startuml');
    expect(plan.reason).toContain('Unsupported diagram language "plantuml"');
  });

  it('uses a generic fallback message when no language is known', () => {
    const plan = getDiagramRenderPlan('A -> B');

    expect(plan.kind).toBe('unsupported');
    if (plan.kind !== 'unsupported') throw new Error('Expected unsupported diagram plan');
    expect(plan.language).toBeUndefined();
    expect(plan.reason).toBe('Unsupported diagram content. Supported diagram blocks currently render Mermaid.');
  });

  it('recognizes diagram language classes without treating ordinary code as diagrams', () => {
    expect(diagramLanguageFromClassName('language-mermaid')).toBe('mermaid');
    expect(diagramLanguageFromClassName('hljs language-plantuml')).toBe('plantuml');
    expect(isDiagramCodeLanguage('mermaid')).toBe(true);
    expect(isDiagramCodeLanguage('typescript')).toBe(false);
  });
});
