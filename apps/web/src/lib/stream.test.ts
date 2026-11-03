import { describe, expect, it, vi } from 'vitest';
import { formatSse, type ChatStreamEvent, type Message } from '@atlas/shared';
import { ApiError } from './api';
import { streamChat } from './stream';

const message: Message = {
  id: 'm1',
  role: 'assistant',
  content: 'Hi [S1].',
  status: 'complete',
  error: null,
  citations: [],
  usage: null,
  latency: null,
  createdAt: '2026-11-03T00:00:00.000Z',
};

const events: ChatStreamEvent[] = [
  { type: 'start', userMessageId: 'u1', assistantMessageId: 'm1' },
  { type: 'sources', sources: [{ n: 1, documentName: 'a.pdf', page: 2 }] },
  { type: 'token', text: 'Hi ' },
  { type: 'token', text: '[S1].' },
  { type: 'done', message },
];

// a response that delivers the wire text in the given pieces
function respond(pieces: string[], status = 200) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
        controller.close();
      },
    }),
    { status, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

const collect = async (signal = new AbortController().signal) => {
  const seen: ChatStreamEvent[] = [];
  await streamChat('/x', { content: 'q' }, { signal, onEvent: (e) => seen.push(e) });
  return seen;
};

describe('streamChat', () => {
  it('delivers every event in order, however the network cuts the bytes', async () => {
    const wire = events.map((e) => formatSse(e.type, e)).join('');
    // cut in the middle of a word, of a JSON string, and between two frames
    const pieces = [wire.slice(0, 25), wire.slice(25, 90), wire.slice(90, 91), wire.slice(91)];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respond(pieces));

    expect(await collect()).toEqual(events);
  });

  it('posts the body as JSON to the API', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respond([]));
    await collect();

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/x');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(init!.body as string)).toEqual({ content: 'q' });
  });

  it('sends no body, and no Content-Type, when there is nothing to send', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respond([]));
    await streamChat('/x', undefined, { signal: new AbortController().signal, onEvent: () => {} });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ body: undefined, headers: {} });
  });

  it('throws a refusal before any stream starts, with the server message and status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'conflict', message: 'An answer is already being written.' },
        }),
        {
          status: 409,
        },
      ),
    );
    const error = await collect().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'conflict',
      message: 'An answer is already being written.',
    });
  });

  it('says something useful when the error body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>Bad gateway</html>', { status: 502 }),
    );
    const error = await collect().catch((e) => e);
    expect(error).toMatchObject({ status: 502, message: 'Something went wrong. Try again.' });
  });

  it('passes the abort signal to the request, so Stop cancels the connection', async () => {
    const controller = new AbortController();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const pending = collect(controller.signal).catch((e) => e);
    controller.abort();

    expect((await pending).name).toBe('AbortError');
    expect(fetch.mock.calls[0]![1]!.signal).toBe(controller.signal);
  });
});
