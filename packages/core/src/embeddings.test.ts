import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config';
import {
  createEmbedder,
  createHashEmbedder,
  createOllamaEmbedder,
  createOpenAIEmbedder,
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
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const error = await createOllamaEmbedder('http://x', 'm', 3)
      .embed(['a'])
      .catch((e) => e);
    expect(error).toMatchObject({ retryable: true });
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
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(status, { error: 'no' }));
      const error = await embedder.embed(['a']).catch((e) => e);
      expect(error).toMatchObject({ retryable });
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
