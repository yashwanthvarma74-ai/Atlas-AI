import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ParseError } from './parse';
import { parseInChild, stopParseChild } from './parse-isolated';

// A stand-in child that behaves as asked, so the parent's handling of each way a child can end is tested with a real
// process, without building the parser into it. `request` is the message; `reply(value)` answers it.
function child(body: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'atlas-child-')), 'child.mjs');
  writeFileSync(
    file,
    `process.on('message', async (request) => { const reply = (v) => process.send({ id: request.id, ...v }); ${body} });`,
  );
  return file;
}
const bytes = new TextEncoder().encode('hello');

afterEach(() => stopParseChild());

describe('parsing in a child process', () => {
  it('returns the pages the child sends back', async () => {
    const path = child(`reply({ pages: [{ page: 1, text: 'hi' }] });`);
    await expect(parseInChild(path, 'text', bytes, 5000)).resolves.toEqual([
      { page: 1, text: 'hi' },
    ]);
  });

  it('keeps one child for the files that follow, instead of starting one per file', async () => {
    const path = child(`reply({ pages: [{ page: 1, text: String(process.pid) }] });`);
    const [first] = await parseInChild(path, 'text', bytes, 5000);
    const [second] = await parseInChild(path, 'text', bytes, 5000);
    expect(second?.text).toBe(first?.text);
  });

  it('passes a file the parser rejected on as a parse error, with the same message', async () => {
    const path = child(`reply({ error: 'This PDF is damaged.', parse: true });`);
    const error = await parseInChild(path, 'pdf', bytes, 5000).catch((e) => e);
    expect(error).toBeInstanceOf(ParseError);
    expect(error.message).toBe('This PDF is damaged.');
  });

  it('survives a child that crashes without answering, and starts a new one for the next file', async () => {
    const crashing = child(`process.exit(9);`);
    await expect(parseInChild(crashing, 'pdf', bytes, 5000)).rejects.toThrow(
      /stopped without an answer/,
    );
    const healthy = child(`reply({ pages: [] });`);
    await expect(parseInChild(healthy, 'pdf', bytes, 5000)).resolves.toEqual([]);
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
      `reply({ pages: [{ page: 1, text: String(process.env.ATLAS_TEST_SECRET) }] });`,
    );
    const [page] = await parseInChild(path, 'text', bytes, 5000);
    expect(page?.text).toBe('undefined');
    delete process.env.ATLAS_TEST_SECRET;
  });
});
