import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatSse, parseNdjson, parseSse } from './sse';

const encode = (text: string) => new TextEncoder().encode(text);

// A body that delivers the given chunks one at a time, as a network would.
function body(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(typeof chunk === 'string' ? encode(chunk) : chunk);
      controller.close();
    },
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('parseSse', () => {
  it('reads named frames', async () => {
    const frames = await collect(parseSse(body(['event: token\ndata: {"text":"Hi"}\n\n'])));
    expect(frames).toEqual([{ event: 'token', data: '{"text":"Hi"}' }]);
  });

  it('calls a frame with no event name "message"', async () => {
    expect(await collect(parseSse(body(['data: hello\n\n'])))).toEqual([
      { event: 'message', data: 'hello' },
    ]);
  });

  it('joins several data lines with a newline', async () => {
    expect(await collect(parseSse(body(['data: one\ndata: two\n\n'])))).toEqual([
      { event: 'message', data: 'one\ntwo' },
    ]);
  });

  it('ignores comments, which keep a connection alive', async () => {
    const frames = await collect(parseSse(body([': ping\n\nevent: a\ndata: 1\n\n: ping\n\n'])));
    expect(frames).toEqual([{ event: 'a', data: '1' }]);
  });

  it('removes one leading space after the colon and no more', async () => {
    expect(await collect(parseSse(body(['data:  two spaces\n\ndata:none\n\n'])))).toEqual([
      { event: 'message', data: ' two spaces' },
      { event: 'message', data: 'none' },
    ]);
  });

  it('accepts \\n, \\r\\n and \\r line endings', async () => {
    const frames = await collect(parseSse(body(['data: a\r\n\r\ndata: b\r\rdata: c\n\n'])));
    expect(frames.map((f) => f.data)).toEqual(['a', 'b', 'c']);
  });

  it('reads a \\r\\n that is split between two chunks as one line break', async () => {
    const frames = await collect(parseSse(body(['data: a\r', '\ndata: b\r\n\r', '\n'])));
    expect(frames).toEqual([{ event: 'message', data: 'a\nb' }]);
  });

  it('drops a frame the stream ended in the middle of', async () => {
    expect(await collect(parseSse(body(['data: whole\n\ndata: cut off'])))).toEqual([
      { event: 'message', data: 'whole' },
    ]);
  });

  it("does not let one frame's event name leak into the next", async () => {
    const frames = await collect(parseSse(body(['event: a\ndata: 1\n\ndata: 2\n\n'])));
    expect(frames.map((f) => f.event)).toEqual(['a', 'message']);
  });

  it('reads multi-byte characters split across chunks', async () => {
    const bytes = encode('data: café 日本\n\n');
    const cut = [...bytes].findIndex((b) => b === 0xc3) + 1; // between the two bytes of "é"
    const frames = await collect(parseSse(body([bytes.slice(0, cut), bytes.slice(cut)])));
    expect(frames).toEqual([{ event: 'message', data: 'café 日本' }]);
  });

  it('gives the same frames however the bytes are cut into chunks', async () => {
    const frames = [
      { event: 'start', data: { id: 1 } },
      { event: 'token', data: 'two\nlines é' },
      { event: 'done', data: { ok: true } },
    ];
    const wire = encode(frames.map((f) => formatSse(f.event, f.data)).join(': ping\n\n'));
    const expected = await collect(parseSse(body([wire])));
    expect(expected).toHaveLength(3);

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: wire.length - 1 }), { maxLength: 12 }),
        async (cuts) => {
          const points = [...new Set([0, ...cuts, wire.length])].sort((a, b) => a - b);
          const chunks = points.slice(1).map((end, i) => wire.slice(points[i], end));
          expect(await collect(parseSse(body(chunks)))).toEqual(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('formatSse', () => {
  it('writes a named frame ending in a blank line', () => {
    expect(formatSse('token', { text: 'Hi' })).toBe('event: token\ndata: {"text":"Hi"}\n\n');
  });

  it('gives each line of a multi-line payload its own data field', () => {
    expect(formatSse('x', 'a\nb\r\nc')).toBe('event: x\ndata: a\ndata: b\ndata: c\n\n');
  });

  it('round-trips through the parser, including text that looks like protocol', async () => {
    const tricky = 'event: fake\ndata: nope\n\n: not a comment';
    const [frame] = await collect(parseSse(body([formatSse('token', tricky)])));
    expect(frame).toEqual({ event: 'token', data: tricky });
  });
});

describe('parseNdjson', () => {
  it('reads one value per line, across chunk boundaries, and skips blank lines', async () => {
    const values = await collect(parseNdjson(body(['{"a":1}\n\n{"b"', ':2}\n{"c":3}'])));
    expect(values).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});
