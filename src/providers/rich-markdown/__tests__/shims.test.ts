import { describe, it, expect } from 'vitest';
import { createHash as realCreateHash } from 'node:crypto';
import { basename as realBasename, extname as realExtname } from 'node:path';
import { createHash as shimCreateHash } from '../shims/crypto';
import { basename as shimBasename, extname as shimExtname } from '../shims/path';

describe('crypto shim (sync SHA-256)', () => {
  const cases = [
    '',
    'abc',
    'flowchart LR\n  A --> B',
    'digraph G {\n  build -> test;\n}',
    'a'.repeat(1000),
    'unicode → 🚀 café ☃',
  ];

  it('matches node:crypto sha256 hex digests byte-for-byte', () => {
    for (const input of cases) {
      const real = realCreateHash('sha256').update(input, 'utf8').digest('hex');
      const shim = shimCreateHash('sha256').update(input, 'utf8').digest('hex');
      expect(shim).toBe(real);
    }
  });

  it('supports chained updates', () => {
    const real = realCreateHash('sha256').update('foo').update('bar').digest('hex');
    const shim = shimCreateHash('sha256').update('foo').update('bar').digest('hex');
    expect(shim).toBe(real);
  });

  it('rejects unsupported algorithms', () => {
    expect(() => shimCreateHash('md5')).toThrow(/unsupported/i);
  });
});

describe('path shim', () => {
  it('matches node:path basename/extname', () => {
    const paths = ['content/org/platform.md', 'a/b/c.tar.gz', 'noext', '.dotfile', 'x/.dotfile'];
    for (const p of paths) {
      expect(shimExtname(p)).toBe(realExtname(p));
      expect(shimBasename(p)).toBe(realBasename(p));
      expect(shimBasename(p, shimExtname(p))).toBe(realBasename(p, realExtname(p)));
    }
  });
});
