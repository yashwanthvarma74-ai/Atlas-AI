import { ObjectId } from 'mongodb';
import type { ChatStreamEvent } from '@atlas/shared';
import type { WorkspaceAccess } from '../access';
import type { Source } from '../citations';
import { createConversation } from '../conversations';
import type { ConversationDoc } from '../db';
import type { ChatEvent, ChatRequest, LlmProvider } from '../llm';
import type { TestCore } from './context';

export const source = (n: number, text = `Passage ${n} says something useful.`): Source => ({
  n,
  chunkId: `chunk-${n}`,
  documentId: `doc-${n}`,
  documentName: `file-${n}.pdf`,
  page: n,
  text,
  score: 1,
});

// A model that says exactly what a test tells it to, and records what it was asked.
export interface ScriptedLlm extends LlmProvider {
  requests: ChatRequest[];
}

export function scripted(
  tokens: string[],
  options: {
    usage?: { inputTokens: number; outputTokens: number };
    // runs before each token, so a test can stop or stall the answer part-way
    beforeToken?: (index: number) => Promise<void> | void;
    fail?: Error;
  } = {},
): ScriptedLlm {
  const requests: ChatRequest[] = [];
  return {
    provider: 'scripted',
    model: 'test',
    requests,
    async *stream(request): AsyncGenerator<ChatEvent> {
      requests.push(request);
      // the question rewriter is a short call of its own: answer it with the question unchanged
      if (request.system.includes('Rewrite the final question')) {
        const lines = request.messages[0]!.content.split('\n');
        yield { type: 'token', text: lines.at(-1)!.replace(/^User: /, '') };
        return;
      }
      for (const [index, text] of tokens.entries()) {
        await options.beforeToken?.(index);
        if (request.signal.aborted) return;
        yield { type: 'token', text };
      }
      if (options.fail) throw options.fail;
      if (options.usage) yield { type: 'usage', ...options.usage };
    },
  };
}

// A model that never answers, and gives up only when its signal fires, as a real network call does.
export function hanging(): ScriptedLlm {
  const requests: ChatRequest[] = [];
  return {
    provider: 'hanging',
    model: 'test',
    requests,
    // eslint-disable-next-line require-yield
    async *stream(request): AsyncGenerator<ChatEvent> {
      requests.push(request);
      await new Promise<void>((resolve) =>
        request.signal.addEventListener('abort', () => resolve()),
      );
    },
  };
}

export async function newConversation(
  core: TestCore,
  access: WorkspaceAccess,
): Promise<ConversationDoc> {
  const { id } = await createConversation(core, access);
  return (await core.database.conversations.findOne({ _id: new ObjectId(id) }))!;
}

export const eventTypes = (events: ChatStreamEvent[]) => events.map((e) => e.type);
