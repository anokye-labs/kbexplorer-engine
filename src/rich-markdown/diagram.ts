export type DiagramRenderPlan =
  | { kind: 'mermaid'; source: string; language: 'mermaid' }
  | { kind: 'unsupported'; source: string; language?: string; reason: string };

const MERMAID_LANGUAGES = new Set(['mermaid', 'mmd']);
const DIAGRAM_LANGUAGES = new Set([
  'diagram',
  'dot',
  'graphviz',
  'mermaid',
  'mmd',
  'plantuml',
  'puml',
]);

const MERMAID_STARTERS = [
  'architecture-beta',
  'block-beta',
  'c4component',
  'c4container',
  'c4context',
  'c4deployment',
  'classdiagram',
  'erdiagram',
  'flowchart',
  'gantt',
  'gitgraph',
  'graph',
  'journey',
  'kanban',
  'mindmap',
  'packet-beta',
  'pie',
  'quadrantchart',
  'radar-beta',
  'requirementdiagram',
  'sankey-beta',
  'sequencediagram',
  'statediagram',
  'statediagram-v2',
  'timeline',
  'xychart-beta',
];

function normalizeLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().toLowerCase();
  return normalized || undefined;
}

export function diagramLanguageFromClassName(className: string): string | undefined {
  const languageClass = className
    .split(/\s+/)
    .find(token => token.startsWith('language-'));
  return normalizeLanguage(languageClass?.slice('language-'.length));
}

export function isDiagramCodeLanguage(language: string | undefined): boolean {
  const normalized = normalizeLanguage(language);
  return normalized ? DIAGRAM_LANGUAGES.has(normalized) : false;
}

export function isMermaidLanguage(language: string | undefined): boolean {
  const normalized = normalizeLanguage(language);
  return normalized ? MERMAID_LANGUAGES.has(normalized) : false;
}

export function extractDiagramFence(content: string): { language?: string; source: string } {
  const trimmed = content.trim();
  const match = trimmed.match(/^```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```$/);
  if (!match) return { source: trimmed };

  const language = normalizeLanguage(match[1]!.split(/\s+/)[0]);
  return {
    ...(language !== undefined ? { language } : {}),
    source: match[2]!.replace(/\s+$/, ''),
  };
}

function firstMermaidLine(source: string): string {
  let remaining = source.trim();
  while (remaining.startsWith('%%{')) {
    const end = remaining.indexOf('}%%');
    if (end < 0) break;
    remaining = remaining.slice(end + 3).trimStart();
  }

  return remaining
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('%%')) ?? '';
}

export function isLikelyMermaidSource(source: string): boolean {
  const firstLine = firstMermaidLine(source).toLowerCase().replace(/\s+/g, '');
  return MERMAID_STARTERS.some(starter => firstLine.startsWith(starter));
}

export function getDiagramRenderPlan(
  content: string,
  languageHint?: string,
): DiagramRenderPlan {
  const fenced = extractDiagramFence(content);
  const language = normalizeLanguage(languageHint) ?? fenced.language;
  const source = fenced.source.trim();

  if (isMermaidLanguage(language) || (!language && isLikelyMermaidSource(source))) {
    return { kind: 'mermaid', source, language: 'mermaid' };
  }

  if (language === 'diagram' && isLikelyMermaidSource(source)) {
    return { kind: 'mermaid', source, language: 'mermaid' };
  }

  const fallbackLanguage = language;
  const reason = fallbackLanguage && fallbackLanguage !== 'diagram'
    ? `Unsupported diagram language "${fallbackLanguage}". Supported diagram blocks currently render Mermaid.`
    : 'Unsupported diagram content. Supported diagram blocks currently render Mermaid.';
  return {
    kind: 'unsupported',
    source,
    ...(fallbackLanguage !== undefined ? { language: fallbackLanguage } : {}),
    reason,
  };
}
