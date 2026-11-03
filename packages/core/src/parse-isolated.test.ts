import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParseError } from './parse';
import { parseInChild } from './parse-isolated';

// A stand-in child that behaves as asked, so the parent's handling of each way a child can end is tested with a real
// process, without building the parser into it.
function child(body: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'atlas-child-')), 'child.mjs');
  writeFileSync(file, `process.once('message', async (request) => { ${body} });`);
  return file;
}
const bytes = new TextEncoder().encode('hello');

describe('parsing in a child process', () => {
  it('returns the pages the child sends back', async () => {
    const path = child(
      `process.send({ pages: [{ page: 1, text: 'hi' }] }, () => process.exit(0));`,
    );
    await expect(parseInChild(path, 'text', bytes, 5000)).resolves.toEqual([
      { page: 1, text: 'hi' },
    ]);
  });

  it('passes a file the parser rejected on as a parse error, with the same message', async () => {
    const path = child(
      `process.send({ error: 'This PDF is damaged.', parse: true }, () => process.exit(0));`,
    );
    const error = await parseInChild(path, 'pdf', bytes, 5000).catch((e) => e);
    expect(error).toBeInstanceOf(ParseError);
    expect(error.message).toBe('This PDF is damaged.');
  });

  it('survives a child that crashes without answering', async () => {
    const path = child(`process.exit(9);`);
    await expect(parseInChild(path, 'pdf', bytes, 5000)).rejects.toThrow(
      /stopped without an answer/,
    );
  });

  it('kills a child that never finishes', async () => {
    const path = child(`setInterval(() => {}, 1000);`);
    const started = Date.now();
    await expect(parseInChild(path, 'pdf', bytes, 300)).rejects.toThrow(/did not finish/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('starts the child with none of the parent environment but what it needs to run', async () => {
    process.env.ATLAS_TEST_SECRET = 'do-not-leak';
    const path = child(
      `process.send({ pages: [{ page: 1, text: String(process.env.ATLAS_TEST_SECRET) }] }, () => process.exit(0));`,
    );
    const [page] = await parseInChild(path, 'text', bytes, 5000);
    expect(page?.text).toBe('undefined');
    delete process.env.ATLAS_TEST_SECRET;
  });
});
