import type { Config } from './config';

export interface Embedder {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  // One vector per text, in order. Vectors have length `dimensions`.
  embed(texts: string[]): Promise<number[][]>;
}

// `retryable` says whether trying again can help: a timeout or a 503 can, a bad API key or a rejected
// request cannot, and the queue should not spend its retries on it.
export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const BATCH_SIZE = 64;
const REQUEST_TIMEOUT_MS = 30_000;

// FNV-1a, 32 bit: small, fast and stable across runs and machines, which matters because the same
// text must always map to the same vector.
function fnv1a(text: string, seed = 0x811c9dc5): number {
  let hash = seed;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const WORD = /[\p{L}\p{N}]+/gu;

// Feature hashing: each word adds +1 or -1 to one slot, chosen by its hash, then the vector is scaled to
// unit length. Texts that share words have vectors that point the same way, so cosine similarity ranks
// them by shared vocabulary. There is no notion of meaning: "car" and "automobile" are unrelated.
export function createHashEmbedder(dimensions: number): Embedder {
  const embedOne = (text: string): number[] => {
    const vector = new Array<number>(dimensions).fill(0);
    for (const [word] of text.toLowerCase().matchAll(WORD)) {
      const slot = fnv1a(word) % dimensions;
      vector[slot]! += fnv1a(word, 0x9747b28c) & 1 ? 1 : -1;
    }
    const norm = Math.hypot(...vector);
    return norm === 0 ? vector : vector.map((x) => x / norm);
  };
  return {
    provider: 'hash',
    model: 'feature-hashing',
    dimensions,
    embed: async (texts) => texts.map(embedOne),
  };
}

async function postJson(url: string, body: unknown, headers: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // unreachable, refused or timed out: all worth another try
    throw new EmbeddingError(
      `Could not reach the embedding service: ${(error as Error).message}`,
      true,
    );
  }
  if (!res.ok) {
    // a rate limit or a server error may pass; any other 4xx will fail the same way every time
    const retryable = res.status === 429 || res.status >= 500;
    throw new EmbeddingError(`The embedding service answered ${res.status}.`, retryable);
  }
  return (await res.json()) as unknown;
}

function checked(vectors: unknown, count: number, dimensions: number): number[][] {
  const ok =
    Array.isArray(vectors) &&
    vectors.length === count &&
    vectors.every((v) => Array.isArray(v) && v.length === dimensions);
  if (!ok) {
    throw new EmbeddingError(
      `The embedding service returned vectors that are not ${dimensions}-dimensional. ` +
        'Set EMBEDDING_DIMENSIONS to the size the model produces.',
      false,
    );
  }
  return vectors as number[][];
}

async function inBatches(texts: string[], send: (batch: string[]) => Promise<number[][]>) {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    out.push(...(await send(texts.slice(i, i + BATCH_SIZE))));
  }
  return out;
}

export function createOllamaEmbedder(url: string, model: string, dimensions: number): Embedder {
  return {
    provider: 'ollama',
    model,
    dimensions,
    embed: (texts) =>
      inBatches(texts, async (batch) => {
        const body = (await postJson(`${url}/api/embed`, { model, input: batch }, {})) as {
          embeddings?: unknown;
        };
        return checked(body.embeddings, batch.length, dimensions);
      }),
  };
}

export function createOpenAIEmbedder(apiKey: string, model: string, dimensions: number): Embedder {
  return {
    provider: 'openai',
    model,
    dimensions,
    embed: (texts) =>
      inBatches(texts, async (batch) => {
        const body = (await postJson(
          'https://api.openai.com/v1/embeddings',
          { model, input: batch, dimensions },
          { Authorization: `Bearer ${apiKey}` },
        )) as { data?: { index: number; embedding: unknown }[] };
        // the API returns one entry per input with an index; do not assume the order
        const ordered = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
        return checked(
          ordered.map((entry) => entry.embedding),
          batch.length,
          dimensions,
        );
      }),
  };
}

export function createEmbedder(config: Config): Embedder {
  const { EMBEDDING_PROVIDER: provider, EMBEDDING_DIMENSIONS: dimensions } = config;
  if (provider === 'ollama') {
    return createOllamaEmbedder(
      config.OLLAMA_URL,
      config.EMBEDDING_MODEL ?? 'nomic-embed-text',
      dimensions,
    );
  }
  if (provider === 'openai') {
    if (!config.OPENAI_API_KEY)
      throw new Error('OPENAI_API_KEY is required for EMBEDDING_PROVIDER=openai.');
    return createOpenAIEmbedder(
      config.OPENAI_API_KEY,
      config.EMBEDDING_MODEL ?? 'text-embedding-3-small',
      dimensions,
    );
  }
  return createHashEmbedder(dimensions);
}
