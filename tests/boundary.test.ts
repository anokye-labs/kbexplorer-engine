import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const FORBIDDEN_BARE_SPECIFIERS = ['react', 'react-dom', 'vis-network', 'vis-data'];
const FORBIDDEN_DOM_GLOBALS = ['document', 'window', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement'];
// Allowed until a later Node-store task introduces the sqlite wasm shim.
const ALLOWED_PLATFORM_EXEMPTIONS = ['src/store/sqlite-runtime.ts'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const toRepoRelative = (filePath: string): string => relative(REPO_ROOT, filePath).split(sep).join('/');

const walkSourceFiles = (root: string): string[] => {
  const files: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }

      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
};

const resolveSpecifier = (fromFile: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const basePath = resolve(dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
    join(basePath, 'index.js'),
    join(basePath, 'index.jsx'),
    join(basePath, 'index.mjs'),
    join(basePath, 'index.cjs'),
  ];

  return candidates.find(candidate => existsSync(candidate)) ?? null;
};

const getImportSpecifiers = (source: string): string[] => {
  const specifiers: string[] = [];
  const regex = /(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const match of source.matchAll(regex)) {
    specifiers.push(match[1] ?? match[2] ?? '');
  }

  return specifiers.filter(Boolean);
};

const isForbiddenImport = (specifier: string): boolean =>
  FORBIDDEN_BARE_SPECIFIERS.some(bareSpecifier => specifier === bareSpecifier || specifier.startsWith(`${bareSpecifier}/`));

describe('package boundary enforcement', () => {
  for (const filePath of walkSourceFiles(SRC_ROOT)) {
    it(`${toRepoRelative(filePath)} stays free of forbidden imports`, () => {
      const source = readFileSync(filePath, 'utf8');
      const violations = getImportSpecifiers(source).filter(isForbiddenImport);

      expect(violations, `${toRepoRelative(filePath)} uses forbidden imports: ${violations.join(', ')}`).toEqual([]);
    });
  }

  it('does not use import.meta.env or Vite import suffixes outside the sqlite wasm shim exemption', () => {
    for (const filePath of walkSourceFiles(SRC_ROOT)) {
      const source = readFileSync(filePath, 'utf8');
      const relPath = toRepoRelative(filePath);
      const violations: string[] = [];

      if (/import\.meta\.env/.test(source)) {
        violations.push('import.meta.env');
      }

      if (/\?url\b|\?raw\b/.test(source) && !ALLOWED_PLATFORM_EXEMPTIONS.includes(relPath)) {
        violations.push('Vite import suffix');
      }

      expect(violations, `${relPath} uses forbidden platform tokens: ${violations.join(', ')}`).toEqual([]);
    }
  });

  it('does not reference DOM globals from the runtime-agnostic entry points', () => {
    for (const filePath of walkSourceFiles(SRC_ROOT)) {
      const source = readFileSync(filePath, 'utf8');
      const relPath = toRepoRelative(filePath);
      const violations = FORBIDDEN_DOM_GLOBALS.filter(globalName => new RegExp(`\\b${globalName}\\b`).test(source));

      expect(violations, `${relPath} references DOM globals: ${violations.join(', ')}`).toEqual([]);
    }
  });
});
