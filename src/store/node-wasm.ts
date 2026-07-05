import { createRequire } from 'node:module';

export function nodeLocateFile(): (file: string) => string {
  const require = createRequire(import.meta.url);
  return (file: string) => require.resolve(`sql.js/dist/${file}`);
}
