import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config';
import {
  complete,
  createAnthropic,
  createExtractive,
  createLlm,
  createOllama,
  createOpenAI,
  LlmError,
  type ChatEvent,
  type ChatRequest,
} from './llm';

afterEach(() => vi.restoreAllMocks());

const request = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  system: 'You answer from sources.',
  messages: [{ role: 'user', content: 'What happened?' }],
  maxTokens: 100,
  signal: new AbortController().signal,
  ...overrides,
});

// A response whose body arrives in the given pieces, as a network delivers it.
const streamOf = (chunks: string[], status = 200) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { status },
  );

const collect = async (events: AsyncIterable<ChatEvent>) => {
  const out: ChatEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};
const textOf = (events: ChatEvent[]) =>
  events.flatMap((e) => (e.type === 'token' ? [e.text] : [])).join('');

describe('OpenAI provider', () => {
  const chunks = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"Rev"}}]}\n\ndata: {"choices":[{"delta":{"content":"enue [S1]."}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":7}}\n\n',
    'data: [DONE]\n\n',
  ];

  it('talks to another OpenAI-compatible service when given its address', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamOf(chunks));
    await collect(createOpenAI('k', 'm', 'https://models.example.test/v1').stream(request()));
    expect(fetch.mock.calls[0]![0]).toBe('https://models.example.test/v1/chat/completions');
  });

  it('streams the text and reports the token counts', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamOf(chunks));
    const events = await collect(createOpenAI('sk-test', 'gpt-test').stream(request()));

    expect(textOf(events)).toBe('Revenue [S1].');
    expect(events.at(-1)).toEqual({ type: 'usage', inputTokens: 120, outputTokens: 7 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      model: 'gpt-test',
      stream: true,
      max_completion_tokens: 100,
      messages: [
        { role: 'system', content: 'You answer from sources.' },
        { role: 'user', content: 'What happened?' },
      ],
    });
  });

  it('retries a rate limit and a server error, but not a bad key, and never leaks the key', async () => {
    for (const [status, retryable] of [
      [429, true],
      [503, true],
      [401, false],
      [400, false],
    ] as const) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamOf([], status));
      const error = await collect(createOpenAI('sk-secret', 'm').stream(request())).catch((e) => e);
      expect(error).toBeInstanceOf(LlmError);
      expect(error).toMatchObject({ retryable });
      expect(error.message).not.toContain('sk-secret');
    }
  });

  it('treats an unreachable service as worth retrying', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const error = await collect(createOpenAI('k', 'm').stream(request())).catch((e) => e);
    expect(error).toMatchObject({ retryable: true });
  });

  it('lets an abort through as an abort, not as a model failure', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const error = await collect(
      createOpenAI('k', 'm').stream(request({ signal: controller.signal })),
    ).catch((e) => e);
    expect(error).not.toBeInstanceOf(LlmError);
    expect(error.name).toBe('AbortError');
  });
});

describe('Anthropic provider', () => {
  const chunks = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":88}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Costs "}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"fell [S2]."}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":9}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];

  it('streams text deltas and combines input and output token counts', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamOf(chunks));
    const events = await collect(createAnthropic('ak-test', 'model-x').stream(request()));

    expect(textOf(events)).toBe('Costs fell [S2].');
    expect(events.at(-1)).toEqual({ type: 'usage', inputTokens: 88, outputTokens: 9 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init!.headers).toMatchObject({
      'x-api-key': 'ak-test',
      'anthropic-version': '2023-06-01',
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      model: 'model-x',
      stream: true,
      max_tokens: 100,
      system: 'You answer from sources.',
      messages: [{ role: 'user', content: 'What happened?' }],
    });
  });

  it('turns an error event in the middle of a stream into a retryable failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamOf(['event: error\ndata: {"type":"error","error":{"message":"Overloaded"}}\n\n']),
    );
    const error = await collect(createAnthropic('k', 'm').stream(request())).catch((e) => e);
    expect(error).toMatchObject({ retryable: true });
  });
});

describe('Ollama provider', () => {
  it('streams lines of JSON and reports the counts on the last one', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        streamOf([
          '{"message":{"content":"Hello"},"done":false}\n{"message":{"content":" there"},"done":false}\n',
          '{"message":{"content":""},"done":true,"prompt_eval_count":30,"eval_count":4}\n',
        ]),
      );
    const events = await collect(createOllama('http://ollama:11434', 'llama').stream(request()));

    expect(textOf(events)).toBe('Hello there');
    expect(events.at(-1)).toEqual({ type: 'usage', inputTokens: 30, outputTokens: 4 });
    expect(fetch.mock.calls[0]![0]).toBe('http://ollama:11434/api/chat');
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).options).toEqual({
      num_predict: 100,
    });
  });
});

describe('extractive provider', () => {
  const sources = `[S1]\nRevenue grew 14 percent in the third quarter. It was driven by Asia.\n\n[S2]\nCosts fell by six percent. The warehouse closed.\n\n[S3]\nUnrelated third source.`;
  const ask = (content: string, system = 'You answer from sources.') =>
    collect(createExtractive().stream(request({ system, messages: [{ role: 'user', content }] })));

  it('quotes the first sentence of the top two sources, each with its number', async () => {
    const events = await ask(`<sources>\n${sources}\n</sources>\n\nQuestion: revenue?`);
    expect(textOf(events)).toBe(
      'From your documents: Revenue grew 14 percent in the third quarter. [S1] Costs fell by six percent. [S2]',
    );
  });

  it('says so when it was given no sources', async () => {
    expect(textOf(await ask('Question: anything?'))).toBe(
      'The documents do not contain an answer to that.',
    );
  });

  it('streams word by word and ends with a usage event', async () => {
    const events = await ask(`${sources}\n\nQuestion: x`);
    expect(events.filter((e) => e.type === 'token').length).toBeGreaterThan(5);
    expect(events.at(-1)?.type).toBe('usage');
  });

  it('stops producing words once aborted', async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    for await (const event of createExtractive().stream(
      request({
        signal: controller.signal,
        messages: [{ role: 'user', content: `${sources}\n\nQ` }],
      }),
    )) {
      if (event.type === 'token') seen.push(event.text);
      if (seen.length === 2) controller.abort();
    }
    expect(seen).toHaveLength(2);
  });

  it('rewrites a short follow-up by joining it to the question before it', async () => {
    const rewriter = 'Rewrite the final question so it stands alone.';
    const joined = await ask(
      'User: How much did revenue grow?\nAssistant: 14 percent.\nUser: and costs?',
      rewriter,
    );
    expect(textOf(joined)).toBe('How much did revenue grow? and costs?');

    const alreadyWhole = await ask(
      'User: first\nUser: What were the operating costs in the third quarter?',
      rewriter,
    );
    expect(textOf(alreadyWhole)).toBe('What were the operating costs in the third quarter?');
  });
});

describe('complete and createLlm', () => {
  it('collects a whole answer and its usage', async () => {
    const result = await complete(
      createExtractive(),
      request({ messages: [{ role: 'user', content: 'Question' }] }),
    );
    expect(result.text).toBe('The documents do not contain an answer to that.');
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it('defaults to the offline provider', () => {
    expect(createLlm(loadConfig({})).provider).toBe('extractive');
  });

  it('gives each hosted provider its own default model, and insists on a key', () => {
    expect(createLlm(loadConfig({ LLM_PROVIDER: 'ollama' })).model).toBe('llama3.2');
    expect(createLlm(loadConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' })).model).toBe(
      'gpt-4o-mini',
    );
    expect(createLlm(loadConfig({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })).model).toBe(
      'claude-haiku-5-5',
    );
    expect(() => createLlm(loadConfig({ LLM_PROVIDER: 'openai' }))).toThrow('OPENAI_API_KEY');
    expect(() => createLlm(loadConfig({ LLM_PROVIDER: 'anthropic' }))).toThrow('ANTHROPIC_API_KEY');
  });
});
