import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config';
import {
  createEmbedder,
  createHashEmbedder,
  createOllamaEmbedder,
  createGeminiEmbedder,
  createOpenAIEmbedder,
  createVoyageEmbedder,
  rateLimited,
  EmbeddingError,
} from './embeddings';

const cosine = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.restoreAllMocks());

describe('hash embedder', () => {
  const embedder = createHashEmbedder(128);

  it('gives the same vector for the same text, every time', async () => {
    const [a] = await embedder.embed(['quarterly revenue grew']);
    const [b] = await embedder.embed(['quarterly revenue grew']);
    expect(a).toEqual(b);
  });

  it('returns unit vectors of the requested size, and a zero vector for empty text', async () => {
    const [vector, empty] = await embedder.embed(['some words here', '   ']);
    expect(vector).toHaveLength(128);
    expect(Math.hypot(...vector!)).toBeCloseTo(1, 6);
    expect(empty!.every((x) => x === 0)).toBe(true);
  });

  it('ranks the text that shares words above the one that does not', async () => {
    const [query, related, unrelated] = await embedder.embed([
      'revenue grew in the third quarter',
      'third quarter revenue increased sharply',
      'the cat sat on the warm windowsill',
    ]);
    expect(cosine(query!, related!)).toBeGreaterThan(cosine(query!, unrelated!));
  });

  it('is case-insensitive and handles non-Latin text', async () => {
    const [a, b, c] = await embedder.embed(['Revenue', 'revenue', '日本語の文書']);
    expect(a).toEqual(b);
    expect(Math.hypot(...c!)).toBeCloseTo(1, 6);
  });
});

describe('ollama embedder', () => {
  it('sends the batch and returns the vectors', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      reply(200, {
        embeddings: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      }),
    );
    const vectors = await createOllamaEmbedder('http://ollama:11434', 'nomic-embed-text', 3).embed([
      'a',
      'b',
    ]);

    expect(vectors).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://ollama:11434/api/embed');
    expect(JSON.parse(init!.body as string)).toEqual({
      model: 'nomic-embed-text',
      input: ['a', 'b'],
    });
  });

  it('splits a large input into several requests, in order', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const { input } = JSON.parse(init!.body as string) as { input: string[] };
      return reply(200, { embeddings: input.map((text) => [Number(text)]) });
    });
    const texts = Array.from({ length: 150 }, (_, i) => String(i));
    const vectors = await createOllamaEmbedder('http://x', 'm', 1).embed(texts);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vectors.map((v) => v[0])).toEqual(texts.map(Number));
  });

  it('says to fix the setting when the model returns another size', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(200, { embeddings: [[1, 2]] }));
    const error = await createOllamaEmbedder('http://x', 'm', 3)
      .embed(['a'])
      .catch((e) => e);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect(error.message).toContain('EMBEDDING_DIMENSIONS');
    expect(error.retryable).toBe(false);
  });

  it('treats an unreachable service as worth retrying', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const result = createOllamaEmbedder('http://x', 'm', 3)
      .embed(['a'])
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await result).toMatchObject({ retryable: true });
    vi.useRealTimers();
  });
});

describe('voyage embedder', () => {
  it('authenticates, asks for the configured size and restores the input order', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      reply(200, {
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }),
    );
    const vectors = await createVoyageEmbedder('vk-test', 'voyage-3.5', 2).embed(['a', 'b']);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer vk-test');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      model: 'voyage-3.5',
      output_dimension: 2,
      input: ['a', 'b'],
    });
  });
});

describe('gemini embedder', () => {
  it('sends one request per text with the key in a header, and returns the vectors in order', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(reply(200, { embeddings: [{ values: [1, 0] }, { values: [0, 1] }] }));
    const vectors = await createGeminiEmbedder('gk-test', 'gemini-embedding-001', 2).embed([
      'a',
      'b',
    ]);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents',
    );
    expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe('gk-test');
    const body = JSON.parse(init!.body as string);
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0]).toEqual({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: 'a' }] },
      outputDimensionality: 2,
    });
  });

  it('rejects vectors of the wrong size without retrying', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(200, { embeddings: [{ values: [1] }] }));
    const error = await createGeminiEmbedder('k', 'm', 2)
      .embed(['a'])
      .catch((e) => e);
    expect(error).toMatchObject({ retryable: false });
  });
});

describe('openai embedder', () => {
  it('authenticates, asks for the configured size and restores the input order', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      reply(200, {
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }),
    );
    const vectors = await createOpenAIEmbedder('sk-test', 'text-embedding-3-small', 2).embed([
      'a',
      'b',
    ]);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    const [, init] = fetch.mock.calls[0]!;
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init!.body as string)).toMatchObject({ dimensions: 2, input: ['a', 'b'] });
  });

  it('retries a rate limit and a server error, but not a bad key', async () => {
    const embedder = createOpenAIEmbedder('sk-test', 'm', 2);
    for (const [status, retryable] of [
      [429, true],
      [503, true],
      [401, false],
      [400, false],
    ] as const) {
      vi.useFakeTimers();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(status, { error: 'no' }));
      const result = embedder.embed(['a']).catch((e) => e);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await result).toMatchObject({ retryable });
      vi.useRealTimers();
    }
  });

  it('never puts the key in an error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(401, {}));
    const error = await createOpenAIEmbedder('sk-secret-key', 'm', 2)
      .embed(['a'])
      .catch((e) => e);
    expect(error.message).not.toContain('sk-secret-key');
  });
});

describe('createEmbedder', () => {
  it('uses the hash embedder by default', () => {
    expect(createEmbedder(loadConfig({})).provider).toBe('hash');
  });

  it('picks each provider its own default model', () => {
    expect(createEmbedder(loadConfig({ EMBEDDING_PROVIDER: 'ollama' })).model).toBe(
      'nomic-embed-text',
    );
    const openai = loadConfig({ EMBEDDING_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-x' });
    expect(createEmbedder(openai).model).toBe('text-embedding-3-small');
  });

  it('refuses to start the OpenAI provider without a key', () => {
    expect(() => createEmbedder(loadConfig({ EMBEDDING_PROVIDER: 'openai' }))).toThrow(
      'OPENAI_API_KEY',
    );
  });
});

describe('a refused batch', () => {
  afterEach(() => vi.useRealTimers());

  it('is tried again after a wait, so one rate limit does not fail the whole document', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(reply(429, {}))
      .mockResolvedValueOnce(reply(503, {}))
      .mockResolvedValueOnce(reply(200, { data: [{ index: 0, embedding: [1, 0] }] }));

    const result = createOpenAIEmbedder('k', 'm', 2).embed(['a']);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toEqual([[1, 0]]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('gives up after five tries and still reports a service that keeps refusing', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(429, {}));

    const result = createOpenAIEmbedder('k', 'm', 2)
      .embed(['a'])
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(await result).toMatchObject({ retryable: true });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('does not wait and try again for a bad key', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(401, {}));
    await createOpenAIEmbedder('k', 'm', 2)
      .embed(['a'])
      .catch(() => undefined);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('rateLimited', () => {
  afterEach(() => vi.useRealTimers());

  it('sends texts in slices and waits between them so it stays under the allowance', async () => {
    vi.useFakeTimers();
    const calls: { size: number; at: number }[] = [];
    const inner = {
      provider: 'x',
      model: 'm',
      dimensions: 1,
      embed: async (texts: string[]) => {
        calls.push({ size: texts.length, at: Date.now() });
        return texts.map(() => [1]);
      },
    };
    const start = Date.now();
    const result = rateLimited(inner, 30).embed(Array.from({ length: 70 }, (_, i) => `t${i}`));
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(await result).toHaveLength(70);
    expect(calls.map((c) => c.size)).toEqual([30, 30, 10]);
    // 30 texts a minute: the second slice waits a minute after the first, the third a minute after that
    expect(calls.map((c) => Math.round((c.at - start) / 60_000))).toEqual([0, 1, 2]);
  });
});
