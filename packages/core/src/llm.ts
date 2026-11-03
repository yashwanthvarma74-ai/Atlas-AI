import { parseNdjson, parseSse } from '@atlas/shared';
import type { Config } from './config';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  // aborting it cancels the call to the provider, which is what the Stop button does
  signal: AbortSignal;
}

export type ChatEvent =
  | { type: 'token'; text: string }
  // as counted by the provider, when it says; some report nothing for a stopped answer
  | { type: 'usage'; inputTokens: number; outputTokens: number };

export interface LlmProvider {
  readonly provider: string;
  readonly model: string;
  stream(request: ChatRequest): AsyncIterable<ChatEvent>;
}

// `retryable` says whether asking again could work: a timeout or a 503 can, a bad key cannot.
export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

// Reads a whole answer. Used for the short calls (rewriting a question) that are not shown as they arrive.
export async function complete(
  llm: LlmProvider,
  request: ChatRequest,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for await (const event of llm.stream(request)) {
    if (event.type === 'token') text += event.text;
    else ({ inputTokens, outputTokens } = event);
  }
  return { text, inputTokens, outputTokens };
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    // an abort is the caller's decision and must reach it unchanged
    if (signal.aborted) throw error;
    throw new LlmError(`Could not reach the model: ${(error as Error).message}`, true);
  }
  if (!res.ok || !res.body) {
    // never include the response body: some providers echo parts of the request, including keys
    throw new LlmError(
      `The model service answered ${res.status}.`,
      res.status === 429 || res.status >= 500,
    );
  }
  return res.body;
}

export function createOpenAI(
  apiKey: string,
  model: string,
  baseUrl = 'https://api.openai.com/v1',
): LlmProvider {
  return {
    provider: 'openai',
    model,
    async *stream({ system, messages, maxTokens, signal }) {
      const body = await post(
        `${baseUrl}/chat/completions`,
        {
          model,
          stream: true,
          // asks for a final chunk with the token counts
          stream_options: { include_usage: true },
          max_completion_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, ...messages],
        },
        { Authorization: `Bearer ${apiKey}` },
        signal,
      );
      for await (const frame of parseSse(body)) {
        if (frame.data === '[DONE]') return;
        const chunk = JSON.parse(frame.data) as {
          choices?: { delta?: { content?: string | null } }[];
          usage?: { prompt_tokens: number; completion_tokens: number } | null;
        };
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield { type: 'token', text };
        if (chunk.usage) {
          yield {
            type: 'usage',
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          };
        }
      }
    },
  };
}

export function createAnthropic(apiKey: string, model: string): LlmProvider {
  return {
    provider: 'anthropic',
    model,
    async *stream({ system, messages, maxTokens, signal }) {
      const body = await post(
        'https://api.anthropic.com/v1/messages',
        { model, stream: true, max_tokens: maxTokens, system, messages },
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal,
      );
      let inputTokens = 0;
      for await (const frame of parseSse(body)) {
        const event = JSON.parse(frame.data) as {
          type: string;
          message?: { usage?: { input_tokens: number } };
          delta?: { type?: string; text?: string };
          usage?: { output_tokens: number };
          error?: { message: string };
        };
        if (event.type === 'error') {
          // a mid-stream error carries no HTTP status, so overload is the common cause worth retrying
          throw new LlmError('The model service reported an error while answering.', true);
        }
        if (event.type === 'message_start') inputTokens = event.message?.usage?.input_tokens ?? 0;
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          event.delta.text
        ) {
          yield { type: 'token', text: event.delta.text };
        }
        if (event.type === 'message_delta' && event.usage) {
          yield { type: 'usage', inputTokens, outputTokens: event.usage.output_tokens };
        }
      }
    },
  };
}

export function createOllama(url: string, model: string): LlmProvider {
  return {
    provider: 'ollama',
    model,
    async *stream({ system, messages, maxTokens, signal }) {
      const body = await post(
        `${url}/api/chat`,
        {
          model,
          stream: true,
          options: { num_predict: maxTokens },
          messages: [{ role: 'system', content: system }, ...messages],
        },
        {},
        signal,
      );
      for await (const line of parseNdjson(body)) {
        const chunk = line as {
          message?: { content?: string };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        if (chunk.message?.content) yield { type: 'token', text: chunk.message.content };
        if (chunk.done) {
          yield {
            type: 'usage',
            inputTokens: chunk.prompt_eval_count ?? 0,
            outputTokens: chunk.eval_count ?? 0,
          };
        }
      }
    },
  };
}

const SOURCE_BLOCK = /^\[S(\d+)\]\n([\s\S]*?)(?=\n\n\[S\d+\]\n|\s*$)/gm;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

// Answers by quoting. It reads the numbered sources out of its prompt, as a model would, and replies with the
// first sentences of the best two, each followed by its number. It cannot paraphrase or reason, so it is
// not a substitute for a model; it is a way to run, test and demonstrate the whole pipeline (retrieval,
// streaming, stopping, citations, history) with no key and no service.
export function createExtractive(delayMs = 0): LlmProvider {
  return {
    provider: 'extractive',
    model: 'quote-top-sources',
    async *stream({ system, messages, signal }) {
      const prompt = messages.at(-1)?.content ?? '';

      // the question rewriter asks for a standalone question; join the follow-up to what it follows
      if (system.includes('Rewrite the final question')) {
        const asked = [...prompt.matchAll(/^User: (.*)$/gm)].map((m) => m[1]!);
        const final = asked.at(-1) ?? '';
        const text =
          asked.length > 1 && final.split(/\s+/).length < 6 ? `${asked.at(-2)} ${final}` : final;
        yield { type: 'token', text };
        yield {
          type: 'usage',
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil(text.length / 4),
        };
        return;
      }

      const sources = [...prompt.matchAll(SOURCE_BLOCK)].map((m) => ({
        n: m[1]!,
        text: m[2]!.trim(),
      }));
      const quoted =
        sources.length === 0
          ? 'The documents do not contain an answer to that.'
          : `From your documents: ${sources
              .slice(0, 2)
              .map((s) => `${s.text.split(/(?<=[.!?])\s+/)[0]} [S${s.n}]`)
              .join(' ')}`;

      // Stands in for a model that can ask to use a tool, so the approval flow can be seen without one: a
      // question that starts with "save" gets the quoted answer proposed as a note.
      const question = /^Question: (.*)$/m.exec(prompt)?.[1] ?? '';
      const wantsSave =
        system.includes('<tool_call>') && /^\s*save\b/i.test(question) && sources.length > 0;
      const note = quoted.replace(/\s*\[S\d+\]/g, '');
      const title = question
        .replace(
          /^\s*save\s+(?:this|that|an?|the)?\s*(?:answer|note|summary)?\s*(?:as|called|titled)?\s*/i,
          '',
        )
        .trim();
      const text = wantsSave
        ? `${quoted}\n\nI can save that as a note. <tool_call>${JSON.stringify({
            tool: 'save_note',
            args: { title: title || 'Note from chat', text: note },
          })}</tool_call>`
        : quoted;

      for (const word of text.split(/(?<=\s)/)) {
        if (signal.aborted) return;
        yield { type: 'token', text: word };
        if (delayMs > 0) await sleep(delayMs, signal);
      }
      yield {
        type: 'usage',
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
      };
    },
  };
}

export function createLlm(config: Config): LlmProvider {
  const model = config.LLM_MODEL;
  switch (config.LLM_PROVIDER) {
    case 'openai':
      if (!config.OPENAI_API_KEY)
        throw new Error('OPENAI_API_KEY is required for LLM_PROVIDER=openai.');
      return createOpenAI(config.OPENAI_API_KEY, model ?? 'gpt-4o-mini', config.OPENAI_BASE_URL);
    case 'anthropic':
      if (!config.ANTHROPIC_API_KEY)
        throw new Error('ANTHROPIC_API_KEY is required for LLM_PROVIDER=anthropic.');
      return createAnthropic(config.ANTHROPIC_API_KEY, model ?? 'claude-haiku-5-5');
    case 'ollama':
      return createOllama(config.OLLAMA_URL, model ?? 'llama3.2');
    default:
      return createExtractive(config.EXTRACTIVE_DELAY_MS);
  }
}
