import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// The workspace packages ship TypeScript source, so they are bundled in. Everything they depend on
// from npm stays external and is installed normally.
const core = JSON.parse(
  readFileSync(new URL('../../packages/core/package.json', import.meta.url), 'utf8'),
);

export default defineConfig({
  entry: ['src/server.ts', 'src/parse-child.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  noExternal: ['@atlas/core', '@atlas/shared'],
  external: Object.keys(core.dependencies).filter((name) => !name.startsWith('@atlas/')),
});
