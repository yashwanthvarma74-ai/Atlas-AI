import { ObjectId } from 'mongodb';
import { DEFAULT_CONVERSATION_TITLE, type ChatStreamEvent, type Message } from '@atlas/shared';
import type { WorkspaceAccess } from './access';
import { extractCitations, type Source } from './citations';
import { toMessage } from './conversations';
import type { Core } from './core';
import { isDuplicateKey, type ConversationDoc, type MessageDoc } from './db';
import { badRequest, conflict, HttpError } from './errors';
import { hex } from './ids';
import { costOf, priceFor } from './pricing';
import { complete, LlmError } from './llm';
import { buildAnswerPrompt, buildRewritePrompt } from './prompt';
import { retrieve } from './retrieve';
import { startSpan, withSpan } from './trace';
import type { Span } from '@opentelemetry/api';
import { proposeToolCalls, splitToolCalls, toolInstructions, toToolCall } from './tools';

export const NO_ANSWER = 'I could not find anything in your documents that answers that.';

// An answer whose writer died (the process was killed, the machine slept) stays "streaming" for ever
// unless something ends it. After this long, it is treated as failed.
const STALE_ANSWER_MS = 5 * 60_000;
const REWRITE_TIMEOUT_MS = 15_000;
const TITLE_LENGTH = 60;

export type AnswerInput = { kind: 'ask'; question: string } | { kind: 'regenerate' };

export interface AnswerDeps {
  retrieve: typeof retrieve;
}

// The reason an answer ended early, in words the person can act on.
const FAILURE = {
  firstToken: 'The model did not start answering in time. Try again.',
  tooLong: 'The answer was longer than the limit and was cut off. Try asking for less.',
  total: 'The model took too long to answer. Try again.',
  other: 'Something went wrong while answering. Try again.',
};

type History = { role: 'user' | 'assistant'; content: string }[];

// Writes one answer, from the question to the saved message, reporting progress through `emit`.
//
//   rewrite the question if it is a follow-up -> retrieve -> stream the model's words -> check the citations
//
// Every way it can end is saved and reported the same way: complete, stopped (the signal fired: the Stop
// button, or the browser going away) or failed. A stopped answer keeps the words that had arrived. Only
// one answer per conversation can be in progress, which the database enforces.
export function answer(
  core: Core,
  access: WorkspaceAccess,
  conversation: ConversationDoc,
  input: AnswerInput,
  signal: AbortSignal,
  emit: (event: ChatStreamEvent) => void,
  deps: AnswerDeps = { retrieve },
): Promise<Message> {
  return withSpan(
    'chat.answer',
    {
      'atlas.workspace_id': hex(access.workspaceId),
      'atlas.conversation_id': hex(conversation._id),
      'atlas.model': `${core.llm.provider}:${core.llm.model}`,
    },
    (span) => writeAnswer(core, access, conversation, input, signal, emit, deps, span),
  );
}

async function writeAnswer(
  core: Core,
  access: WorkspaceAccess,
  conversation: ConversationDoc,
  input: AnswerInput,
  signal: AbortSignal,
  emit: (event: ChatStreamEvent) => void,
  deps: AnswerDeps,
  span: Span,
): Promise<Message> {
  const { config, database } = core;
  const started = performance.now();
  const send = (event: ChatStreamEvent) => {
    try {
      emit(event);
    } catch {
      // the browser is gone; the answer is still finished and saved
    }
  };

  await failStaleAnswers(core, conversation._id);

  const { question, history, userMessage } = await prepareTurn(core, conversation, input);
  const assistant: MessageDoc = {
    _id: new ObjectId(),
    conversationId: conversation._id,
    workspaceId: access.workspaceId,
    role: 'assistant',
    content: '',
    status: 'streaming',
    error: null,
    citations: [],
    usage: null,
    costUsd: null,
    latency: null,
    model: `${core.llm.provider}:${core.llm.model}`,
    createdAt: new Date(),
  };

  // The placeholder takes the one streaming slot first. If another answer holds it, nothing has been
  // changed yet and the caller is told to wait.
  try {
    await database.messages.insertOne(assistant);
  } catch (error) {
    if (isDuplicateKey(error))
      throw conflict('An answer is already being written for this conversation.');
    throw error;
  }
  const savedQuestion =
    userMessage ?? (await saveQuestion(core, access, conversation, question, assistant.createdAt));
  send({
    type: 'start',
    userMessageId: hex(savedQuestion._id),
    assistantMessageId: hex(assistant._id),
  });

  let content = '';
  let sources: Source[] = [];
  let usage: MessageDoc['usage'] = null;
  let retrievalMs = 0;
  let ttftMs: number | null = null;
  let status: MessageDoc['status'] = 'complete';
  let error: string | null = null;

  // our own limits, kept apart from the person's Stop so the two can be told apart afterwards
  const limits = new AbortController();
  const totalTimer = setTimeout(() => limits.abort('total'), config.CHAT_TOTAL_TIMEOUT_MS);
  let firstTokenTimer: NodeJS.Timeout | undefined;
  let modelSpan: Span | undefined;
  const combined = AbortSignal.any([signal, limits.signal]);
  // generous: a token is about four characters
  const maxCharacters = config.CHAT_MAX_OUTPUT_TOKENS * 8;

  try {
    const standalone = await withSpan('chat.rewrite', {}, () =>
      rewrite(core, question, history, signal),
    );
    if (signal.aborted) throw new DOMException('stopped', 'AbortError');

    const retrievalStart = performance.now();
    sources = await withSpan('chat.retrieve', {}, async (retrieving) => {
      const found = await deps.retrieve(core, access, standalone);
      retrieving.setAttribute('atlas.sources', found.length);
      return found;
    });
    retrievalMs = Math.round(performance.now() - retrievalStart);
    if (signal.aborted) throw new DOMException('stopped', 'AbortError');
    send({
      type: 'sources',
      sources: sources.map(({ n, documentName, page }) => ({ n, documentName, page })),
    });

    if (sources.length === 0) {
      // nothing to answer from, so there is nothing to ask a model, and nothing to pay for
      content = NO_ANSWER;
      send({ type: 'token', text: NO_ANSWER });
    } else {
      const prompt = buildAnswerPrompt(
        question,
        sources,
        history,
        config.TOOLS_ENABLED ? toolInstructions(core.tools) : '',
      );
      modelSpan = startSpan('chat.model', {
        'atlas.model': `${core.llm.provider}:${core.llm.model}`,
      });
      firstTokenTimer = setTimeout(
        () => limits.abort('first-token'),
        config.CHAT_FIRST_TOKEN_TIMEOUT_MS,
      );
      const words = untilAborted(
        core.llm.stream({ ...prompt, maxTokens: config.CHAT_MAX_OUTPUT_TOKENS, signal: combined }),
        combined,
      );
      for await (const event of words) {
        if (event.type === 'usage') {
          usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
          continue;
        }
        if (ttftMs === null) {
          ttftMs = Math.round(performance.now() - started);
          clearTimeout(firstTokenTimer);
        }
        content += event.text;
        send({ type: 'token', text: event.text });
        // The provider was asked for at most so many tokens. If it ignores that, the answer is cut off here
        // rather than growing without end in memory, on the wire and in the database.
        if (content.length > maxCharacters) limits.abort('too-long');
      }
      // a provider that stops quietly when aborted ends the loop without throwing
      if (combined.aborted) throw combined.reason ?? new DOMException('stopped', 'AbortError');
    }
  } catch (caught) {
    if (signal.aborted) {
      status = 'stopped';
    } else {
      status = 'failed';
      if (limits.signal.aborted) {
        error =
          limits.signal.reason === 'first-token'
            ? FAILURE.firstToken
            : limits.signal.reason === 'too-long'
              ? FAILURE.tooLong
              : FAILURE.total;
      } else if (caught instanceof LlmError || caught instanceof HttpError) {
        error = caught.message;
      } else {
        core.logger.error({ err: caught, conversationId: hex(conversation._id) }, 'answer failed');
        error = FAILURE.other;
      }
    }
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(firstTokenTimer);
    modelSpan?.setAttributes({
      'atlas.ttft_ms': ttftMs ?? -1,
      'atlas.input_tokens': usage?.inputTokens ?? 0,
      'atlas.output_tokens': usage?.outputTokens ?? 0,
    });
    modelSpan?.end();
  }

  // Tool calls are requests the model wrote into its answer. They are taken out of the words the person reads,
  // and only an answer that finished can ask for anything: half an answer is not an instruction.
  const requests = config.TOOLS_ENABLED ? splitToolCalls(content) : { text: content, calls: [] };
  const asked = status === 'complete' ? requests.calls : [];

  // Citations are resolved against what this question was given, and numbers it was not given are dropped.
  const checked = extractCitations(requests.text, sources);
  const finished: MessageDoc = {
    ...assistant,
    content: checked.text,
    status,
    error,
    citations: checked.citations,
    usage,
    costUsd: costOf(priceFor(config, core.llm.provider, core.llm.model), usage),
    latency: { retrievalMs, ttftMs, totalMs: Math.round(performance.now() - started) },
  };
  await database.messages.replaceOne(
    { _id: assistant._id, workspaceId: access.workspaceId },
    finished,
  );
  await database.conversations.updateOne(
    { _id: conversation._id, workspaceId: access.workspaceId },
    { $set: { updatedAt: new Date() } },
  );

  const proposals =
    asked.length > 0
      ? await proposeToolCalls(core, access, conversation._id, assistant._id, asked)
      : [];
  const toolCalls = await Promise.all(proposals.map((doc) => toToolCall(core, doc)));

  span.setAttributes({
    'atlas.status': status,
    'atlas.retrieval_ms': retrievalMs,
    'atlas.ttft_ms': ttftMs ?? -1,
    'atlas.total_ms': finished.latency?.totalMs ?? 0,
    'atlas.cost_usd': finished.costUsd ?? -1,
  });
  const message = toMessage(finished);
  send({ type: 'done', message, toolCalls });
  return message;
}

// What was said before this turn, and what is being asked. For a regenerate, the last answer is removed
// and its question is asked again.
async function prepareTurn(
  core: Core,
  conversation: ConversationDoc,
  input: AnswerInput,
): Promise<{ question: string; history: History; userMessage?: MessageDoc }> {
  const { database, config } = core;
  const recent = await database.messages
    .find({ conversationId: conversation._id, workspaceId: conversation.workspaceId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(config.CHAT_HISTORY_MESSAGES * 2 + 4)
    .toArray();
  recent.reverse();

  if (input.kind === 'ask') {
    return {
      question: input.question,
      history: trim(completedTurns(recent), config.CHAT_HISTORY_MESSAGES),
    };
  }

  const last = recent.at(-1);
  const question = recent.at(-2);
  if (last?.role !== 'assistant' || question?.role !== 'user') {
    throw badRequest('There is no answer to write again.');
  }
  if (last.status === 'streaming')
    throw conflict('An answer is already being written for this conversation.');
  await database.messages.deleteOne({ _id: last._id, workspaceId: conversation.workspaceId });
  return {
    question: question.content,
    history: trim(completedTurns(recent.slice(0, -2)), config.CHAT_HISTORY_MESSAGES),
    userMessage: question,
  };
}

// Question and answer pairs where the answer was written (or stopped part-way). A question whose answer
// failed is left out with it: shown alone it would be two user turns in a row, which some providers refuse,
// and a failed answer is nothing to build on anyway.
function completedTurns(messages: MessageDoc[]): MessageDoc[] {
  const turns: MessageDoc[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const [question, reply] = [messages[i]!, messages[i + 1]!];
    if (
      question.role === 'user' &&
      reply.role === 'assistant' &&
      (reply.status === 'complete' || reply.status === 'stopped')
    ) {
      turns.push(question, reply);
      i++;
    }
  }
  return turns;
}

// The last `count` messages, starting on a question so the model never sees an answer with nothing before it.
function trim(messages: MessageDoc[], count: number): History {
  const tail = count === 0 ? [] : messages.slice(-count);
  const firstUser = tail.findIndex((m) => m.role === 'user');
  return tail.slice(Math.max(firstUser, 0)).map(({ role, content }) => ({ role, content }));
}

async function saveQuestion(
  core: Core,
  access: WorkspaceAccess,
  conversation: ConversationDoc,
  content: string,
  // the time of the answer being written for it
  answerAt: Date,
): Promise<MessageDoc> {
  const doc: MessageDoc = {
    _id: new ObjectId(),
    conversationId: conversation._id,
    workspaceId: access.workspaceId,
    role: 'user',
    content,
    status: 'complete',
    error: null,
    citations: [],
    usage: null,
    costUsd: null,
    latency: null,
    model: null,
    // always a millisecond before its answer, so the two sort in the order they were asked and answered
    createdAt: new Date(answerAt.getTime() - 1),
  };
  await core.database.messages.insertOne(doc);

  const set: Partial<ConversationDoc> = { updatedAt: new Date() };
  if (conversation.title === DEFAULT_CONVERSATION_TITLE) {
    const oneLine = content.replace(/\s+/g, ' ').trim();
    set.title =
      oneLine.length > TITLE_LENGTH ? `${oneLine.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : oneLine;
  }
  await core.database.conversations.updateOne(
    { _id: conversation._id, workspaceId: access.workspaceId },
    { $set: set },
  );
  return doc;
}

// A follow-up like "and costs?" means nothing to a search. A short call to the model turns it into a
// question that stands alone. If that call fails the original question is searched as it is: rewriting
// improves a search, it is never a reason to refuse one.
async function rewrite(
  core: Core,
  question: string,
  history: History,
  signal: AbortSignal,
): Promise<string> {
  if (history.length === 0) return question;
  try {
    const { text } = await complete(core.llm, {
      ...buildRewritePrompt(question, history),
      maxTokens: 120,
      signal: AbortSignal.any([signal, AbortSignal.timeout(REWRITE_TIMEOUT_MS)]),
    });
    const standalone = text.replace(/\s+/g, ' ').trim();
    return standalone && standalone.length <= 500 ? standalone : question;
  } catch {
    return question;
  }
}

async function failStaleAnswers(core: Core, conversationId: ObjectId): Promise<void> {
  await core.database.messages.updateMany(
    {
      conversationId,
      status: 'streaming',
      createdAt: { $lt: new Date(Date.now() - STALE_ANSWER_MS) },
    },
    { $set: { status: 'failed', error: 'The answer was interrupted.' } },
  );
}

// For the worker's sweep: ends every answer in the database whose writer died.
export async function failAllStaleAnswers(core: Core): Promise<number> {
  const result = await core.database.messages.updateMany(
    { status: 'streaming', createdAt: { $lt: new Date(Date.now() - STALE_ANSWER_MS) } },
    { $set: { status: 'failed', error: 'The answer was interrupted.' } },
  );
  return result.modifiedCount;
}

// Ends the iteration the moment the signal fires, even if the source is stuck waiting. A provider's
// network call rejects when aborted, but an answer must not depend on every provider being well behaved:
// a stalled one would hold the conversation's single answer slot until the process was restarted.
async function* untilAborted<T>(source: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  const aborted = new Promise<never>((_, reject) => {
    const stop = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
  // the race below is the only reader; without this a signal that fires between reads is "unhandled"
  aborted.catch(() => undefined);

  try {
    for (;;) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    // best effort: a source stuck on a pending read cannot be closed until that read ends
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
}
