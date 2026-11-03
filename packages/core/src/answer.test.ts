import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent } from '@atlas/shared';
import { answer, NO_ANSWER, type AnswerDeps } from './answer';
import { getConversation } from './conversations';
import { createExtractive, LlmError } from './llm';
import { HttpError } from './errors';
import { createTestCore, type TestCore } from './test/context';
import { eventTypes, hanging, newConversation, scripted, source } from './test/chat';
import type { WorkspaceAccess } from './access';

let core: TestCore;
let ws: WorkspaceAccess;
beforeAll(async () => {
  core = await createTestCore({ CHAT_FIRST_TOKEN_TIMEOUT_MS: '60000' });
  ws = await core.workspace(await core.user('owner@answer.test'));
});
afterAll(() => core.destroy());

const found = (...sources: ReturnType<typeof source>[]): AnswerDeps => ({
  retrieve: async () => sources,
});

async function ask(
  llm: ReturnType<typeof scripted>,
  deps: AnswerDeps,
  question = 'What grew?',
  options: {
    signal?: AbortSignal;
    overrides?: Record<string, unknown>;
    conversation?: Awaited<ReturnType<typeof newConversation>>;
  } = {},
) {
  const conversation = options.conversation ?? (await newConversation(core, ws));
  const events: ChatStreamEvent[] = [];
  const message = await answer(
    { ...core, llm, ...(options.overrides ?? {}) } as typeof core,
    ws,
    conversation,
    { kind: 'ask', question },
    options.signal ?? new AbortController().signal,
    (event) => events.push(event),
    deps,
  );
  return { message, events, conversation };
}

describe('a finished answer', () => {
  it('reports start, sources, tokens and the saved message, in that order', async () => {
    const llm = scripted(['Revenue ', 'grew [S1].'], {
      usage: { inputTokens: 90, outputTokens: 5 },
    });
    const { events, message } = await ask(llm, found(source(1)));

    expect(eventTypes(events)).toEqual(['start', 'sources', 'token', 'token', 'done']);
    expect(events[1]).toEqual({
      type: 'sources',
      sources: [{ n: 1, documentName: 'file-1.pdf', page: 1 }],
    });
    expect(message).toMatchObject({
      role: 'assistant',
      content: 'Revenue grew [S1].',
      status: 'complete',
      error: null,
      usage: { inputTokens: 90, outputTokens: 5 },
    });
    expect(message.citations).toEqual([
      expect.objectContaining({ n: 1, documentName: 'file-1.pdf', page: 1, chunkId: 'chunk-1' }),
    ]);
  });

  it('works out what the answer cost from the tokens and the configured price', async () => {
    const priced = {
      config: { ...core.config, LLM_PRICE_INPUT_PER_MTOK: 1, LLM_PRICE_OUTPUT_PER_MTOK: 2 },
    };
    const { message } = await ask(
      scripted(['Fine [S1].'], { usage: { inputTokens: 1000, outputTokens: 500 } }),
      found(source(1)),
      'q',
      { overrides: priced },
    );
    // 1,000 x $1/M + 500 x $2/M
    expect(message.costUsd).toBeCloseTo(0.002, 10);
  });

  it('records the cost as unknown, not zero, when the model has no known price', async () => {
    const { message } = await ask(
      scripted(['Fine.'], { usage: { inputTokens: 10, outputTokens: 5 } }),
      found(source(1)),
    );
    expect(message.costUsd).toBeNull();
  });

  it('records where the time went', async () => {
    const { message } = await ask(scripted(['ok']), found(source(1)));
    expect(message.latency).toEqual({
      retrievalMs: expect.any(Number),
      ttftMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
    expect(message.latency!.totalMs).toBeGreaterThanOrEqual(message.latency!.ttftMs!);
  });

  it('removes a citation to a source it was never given, from the saved text too', async () => {
    const { message } = await ask(scripted(['Costs fell [S1] and rose [S7].']), found(source(1)));
    expect(message.content).toBe('Costs fell [S1] and rose.');
    expect(message.citations.map((c) => c.n)).toEqual([1]);
  });

  it('saves the question first, titles the conversation after it, and keeps them in order', async () => {
    const { conversation } = await ask(
      scripted(['Answer.']),
      found(source(1)),
      'How much did revenue grow in Asia?',
    );
    const { conversation: saved, messages } = await getConversation(core, ws, conversation._id);

    expect(saved.title).toBe('How much did revenue grow in Asia?');
    expect(messages.map((m) => [m.role, m.status])).toEqual([
      ['user', 'complete'],
      ['assistant', 'complete'],
    ]);
    expect(messages[0]?.content).toBe('How much did revenue grow in Asia?');
  });

  it('shortens a long first question into a title', async () => {
    const { conversation } = await ask(
      scripted(['x']),
      found(source(1)),
      `${'word '.repeat(40)}end`,
    );
    const saved = await core.database.conversations.findOne({ _id: conversation._id });
    expect(saved!.title.length).toBeLessThanOrEqual(60);
    expect(saved!.title.endsWith('…')).toBe(true);
  });

  it('does not ask a model when there is nothing to answer from', async () => {
    const llm = scripted(['should never be said']);
    const { message, events } = await ask(llm, found());

    expect(message).toMatchObject({ content: NO_ANSWER, status: 'complete', usage: null });
    expect(llm.requests).toHaveLength(0);
    expect(eventTypes(events)).toEqual(['start', 'sources', 'token', 'done']);
  });

  it('works end to end with the extractive model, which quotes its sources', async () => {
    const llm = { ...createExtractive(), requests: [] };
    const { message } = await ask(
      llm,
      found(source(1, 'Revenue grew 14 percent. It was Asia.'), source(2, 'Costs fell.')),
    );
    expect(message.content).toBe(
      'From your documents: Revenue grew 14 percent. [S1] Costs fell. [S2]',
    );
    expect(message.citations.map((c) => c.n)).toEqual([1, 2]);
  });

  it('survives the browser going away mid-answer: a failing emit does not lose the message', async () => {
    const conversation = await newConversation(core, ws);
    const message = await answer(
      { ...core, llm: scripted(['Fine [S1].']) },
      ws,
      conversation,
      { kind: 'ask', question: 'q' },
      new AbortController().signal,
      () => {
        throw new Error('socket closed');
      },
      found(source(1)),
    );
    expect(message.status).toBe('complete');
    expect((await getConversation(core, ws, conversation._id)).messages).toHaveLength(2);
  });
});

const askToSave =
  '<tool_call>{"tool":"save_note","args":{"title":"Summary","text":"Revenue grew."}}</tool_call>';

describe('tool requests', () => {
  it('takes the request out of the words, and saves it as waiting for a person', async () => {
    const llm = scripted(['Revenue grew [S1]. I can save that. ', askToSave]);
    const { message, events } = await ask(llm, found(source(1)));

    expect(message.content).toBe('Revenue grew [S1]. I can save that.');
    const done = events.find((e) => e.type === 'done');
    expect(done?.type === 'done' && done.toolCalls).toEqual([
      expect.objectContaining({
        tool: 'save_note',
        status: 'proposed',
        description: 'Save a note called "Summary" in this workspace',
      }),
    ]);
    // nothing has run: it is waiting
    expect(await core.database.documents.countDocuments({ name: 'Summary.md' })).toBe(0);
  });

  it('keeps the request with the conversation, so it is still there on reload', async () => {
    const { conversation } = await ask(scripted(['Done. ', askToSave]), found(source(1)));
    const { toolCalls } = await getConversation(core, ws, conversation._id);
    expect(toolCalls.map((c) => [c.tool, c.status])).toEqual([['save_note', 'proposed']]);
  });

  it('does not act on an answer that was stopped, even if it had written a whole request', async () => {
    const controller = new AbortController();
    const llm = scripted(['Saving now. ', askToSave, ' and more'], {
      beforeToken: (index) => {
        if (index === 2) controller.abort();
      },
    });
    const { message, conversation } = await ask(llm, found(source(1)), 'q', {
      signal: controller.signal,
    });

    expect(message.status).toBe('stopped');
    expect(message.content).toBe('Saving now.');
    expect((await getConversation(core, ws, conversation._id)).toolCalls).toEqual([]);
  });

  it('does not act on an answer that failed part-way, and hides the half-written request', async () => {
    const llm = scripted(['Saving. <tool_call>{"tool":"save_note","args":{"ti'], {
      fail: new LlmError('down', false),
    });
    const { message, conversation } = await ask(llm, found(source(1)));

    expect(message.status).toBe('failed');
    expect(message.content).toBe('Saving.');
    expect((await getConversation(core, ws, conversation._id)).toolCalls).toEqual([]);
  });

  it('records a request for something that does not exist, and offers nothing to approve', async () => {
    const llm = scripted(['Ok. <tool_call>{"tool":"delete_everything","args":{}}</tool_call>']);
    const { events } = await ask(llm, found(source(1)));
    const done = events.find((e) => e.type === 'done');
    expect(done?.type === 'done' && done.toolCalls[0]).toMatchObject({
      tool: 'delete_everything',
      status: 'invalid',
    });
  });

  it('tells the model about the tools, and leaves them out when they are switched off', async () => {
    const on = scripted(['x']);
    await ask(on, found(source(1)));
    expect(on.requests.at(-1)!.system).toContain('save_note');

    const off = scripted([
      'x <tool_call>{"tool":"save_note","args":{"title":"t","text":"x"}}</tool_call>',
    ]);
    const { message, conversation } = await ask(off, found(source(1)), 'q', {
      overrides: { config: { ...core.config, TOOLS_ENABLED: false } },
    });
    expect(off.requests.at(-1)!.system).not.toContain('save_note');
    // switched off means the text is just text: nothing is read as a request
    expect(message.content).toContain('<tool_call>');
    expect((await getConversation(core, ws, conversation._id)).toolCalls).toEqual([]);
  });

  it('lets the offline model show the flow: a question that starts with "save" proposes a note', async () => {
    const llm = { ...createExtractive(), requests: [] };
    const { message, events } = await ask(
      llm,
      found(source(1, 'Revenue grew 14 percent. It was Asia.')),
      'save this answer as Q3 revenue',
    );

    expect(message.content).toContain('I can save that as a note.');
    expect(message.content).not.toContain('<tool_call>');
    const done = events.find((e) => e.type === 'done');
    const call = done?.type === 'done' ? done.toolCalls[0] : undefined;
    expect(call).toMatchObject({
      tool: 'save_note',
      status: 'proposed',
      args: { title: 'Q3 revenue' },
    });
    // the saved text has the quoted answer without its citation numbers, which belong to this answer only
    expect(call?.args.text).toBe('From your documents: Revenue grew 14 percent.');
  });
});

describe('message order', () => {
  it('keeps questions and answers alternating however fast they are asked', async () => {
    // the question and its answer are saved within the same millisecond; the order must not depend on luck
    const conversation = await newConversation(core, ws);
    for (let i = 1; i <= 12; i++)
      await ask(scripted([`Answer ${i}.`]), found(source(1)), `Question ${i}`, { conversation });

    const { messages } = await getConversation(core, ws, conversation._id);
    expect(messages.map((m) => m.content)).toEqual(
      Array.from({ length: 12 }, (_, i) => [`Question ${i + 1}`, `Answer ${i + 1}.`]).flat(),
    );
  });
});

describe('stopping', () => {
  it('keeps the words that arrived, marks the answer stopped, and cancels the call to the model', async () => {
    const controller = new AbortController();
    const llm = scripted(['Revenue grew [S1], ', 'and then ', 'it kept growing.'], {
      beforeToken: (index) => {
        if (index === 2) controller.abort();
      },
    });
    const { message } = await ask(llm, found(source(1)), 'q', { signal: controller.signal });

    expect(message.status).toBe('stopped');
    expect(message.error).toBeNull();
    expect(message.content).toBe('Revenue grew [S1], and then ');
    expect(message.citations.map((c) => c.n)).toEqual([1]);
    expect(llm.requests[0]!.signal.aborted).toBe(true);
  });

  it('stops before the model is called when it is stopped during the search', async () => {
    const controller = new AbortController();
    const llm = scripted(['never']);
    const slowSearch: AnswerDeps = {
      retrieve: async () => {
        controller.abort();
        return [source(1)];
      },
    };
    const { message } = await ask(llm, slowSearch, 'q', { signal: controller.signal });

    expect(message.status).toBe('stopped');
    expect(llm.requests).toHaveLength(0);
  });

  it('is saved the same way when nobody is listening any more', async () => {
    const controller = new AbortController();
    controller.abort();
    const { message, conversation } = await ask(scripted(['x']), found(source(1)), 'q', {
      signal: controller.signal,
    });
    expect(message.status).toBe('stopped');
    expect((await getConversation(core, ws, conversation._id)).messages.at(-1)?.status).toBe(
      'stopped',
    );
  });
});

describe('failing', () => {
  it('shows the reason a model reports, and keeps the words it had written', async () => {
    const llm = scripted(['Half an ans'], {
      fail: new LlmError('The model service answered 503.', true),
    });
    const { message } = await ask(llm, found(source(1)));
    expect(message).toMatchObject({
      status: 'failed',
      error: 'The model service answered 503.',
      content: 'Half an ans',
    });
  });

  it('hides an unexpected error behind a plain message, and logs the real one', async () => {
    const logger = { ...core.logger, error: vi.fn() } as unknown as typeof core.logger;
    const llm = scripted([], {
      fail: new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
    });
    const { message } = await ask(llm, found(source(1)), 'q', { overrides: { logger } });

    expect(message.error).toBe('Something went wrong while answering. Try again.');
    expect(JSON.stringify(message)).not.toContain('hunter2');
    expect(logger.error).toHaveBeenCalled();
  });

  it('fails with the search error when the search is unavailable', async () => {
    const down: AnswerDeps = {
      retrieve: async () => {
        throw new HttpError(503, 'unavailable', 'The embedding service is unavailable.');
      },
    };
    const llm = scripted(['never']);
    const { message } = await ask(llm, down);
    expect(message).toMatchObject({
      status: 'failed',
      error: 'The embedding service is unavailable.',
    });
    expect(llm.requests).toHaveLength(0);
  });

  it('gives up on a model that never starts answering', async () => {
    const { message } = await ask(hanging(), found(source(1)), 'q', {
      overrides: { config: { ...core.config, CHAT_FIRST_TOKEN_TIMEOUT_MS: 40 } },
    });
    expect(message).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/did not start answering/),
    });
  });

  it('gives up on a model that starts and then stalls', async () => {
    const llm = scripted(['Starting ', 'and stalling'], {
      beforeToken: async (index) => {
        if (index === 1) await new Promise(() => {});
      },
    });
    const { message } = await ask(llm, found(source(1)), 'q', {
      overrides: { config: { ...core.config, CHAT_TOTAL_TIMEOUT_MS: 60 } },
    });
    expect(message.status).toBe('failed');
    expect(message.error).toMatch(/took too long/);
    expect(message.content).toBe('Starting ');
  });
});

describe('one answer at a time', () => {
  it('refuses a second answer while the first is being written, then allows one after', async () => {
    const conversation = await newConversation(core, ws);
    const gate = (() => {
      let open!: () => void;
      const promise = new Promise<void>((resolve) => (open = resolve));
      return { promise, open };
    })();
    const slow = scripted(['Slow ', 'answer.'], {
      beforeToken: (i) => (i === 1 ? gate.promise : undefined),
    });

    const first = ask(slow, found(source(1)), 'first', { conversation });
    await vi.waitFor(async () =>
      expect(
        await core.database.messages.countDocuments({
          conversationId: conversation._id,
          status: 'streaming',
        }),
      ).toBe(1),
    );

    await expect(
      ask(scripted(['x']), found(source(1)), 'second', { conversation }),
    ).rejects.toMatchObject({ status: 409 });
    gate.open();
    await first;

    const { message } = await ask(scripted(['Now fine.']), found(source(1)), 'third', {
      conversation,
    });
    expect(message.status).toBe('complete');
    // the refused question left nothing behind
    const { messages } = await getConversation(core, ws, conversation._id);
    expect(messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'first',
      'third',
    ]);
  });

  it('treats an answer whose writer died long ago as failed, and carries on', async () => {
    const conversation = await newConversation(core, ws);
    await core.database.messages.insertOne({
      _id: new ObjectId(),
      conversationId: conversation._id,
      workspaceId: ws.workspaceId,
      role: 'assistant',
      content: 'half',
      status: 'streaming',
      error: null,
      citations: [],
      usage: null,
      costUsd: null,
      latency: null,
      model: null,
      createdAt: new Date(Date.now() - 10 * 60_000),
    });

    const { message } = await ask(scripted(['Fresh.']), found(source(1)), 'again', {
      conversation,
    });
    expect(message.status).toBe('complete');
    const stale = (await getConversation(core, ws, conversation._id)).messages.find(
      (m) => m.content === 'half',
    );
    expect(stale).toMatchObject({ status: 'failed', error: 'The answer was interrupted.' });
  });
});

describe('follow-up questions', () => {
  it('searches for the rewritten question, not the fragment', async () => {
    const conversation = await newConversation(core, ws);
    await ask(
      scripted(['Revenue grew 14 percent [S1].']),
      found(source(1)),
      'How much did revenue grow?',
      { conversation },
    );

    const searched: string[] = [];
    const spy: AnswerDeps = { retrieve: async (_c, _a, q) => (searched.push(q), [source(1)]) };
    const llm = { ...createExtractive(), requests: [] };
    await ask(llm, spy, 'and costs?', { conversation });

    expect(searched).toEqual(['How much did revenue grow? and costs?']);
  });

  it('searches the question as asked when the rewrite fails', async () => {
    const conversation = await newConversation(core, ws);
    await ask(scripted(['First.']), found(source(1)), 'first question', { conversation });

    const searched: string[] = [];
    const spy: AnswerDeps = { retrieve: async (_c, _a, q) => (searched.push(q), [source(1)]) };
    const broken = scripted(['Second.']);
    const original = broken.stream.bind(broken);
    broken.stream = (request) => {
      if (request.system.includes('Rewrite')) throw new LlmError('down', true);
      return original(request);
    };
    const { message } = await ask(broken, spy, 'and then?', { conversation });

    expect(searched).toEqual(['and then?']);
    expect(message.status).toBe('complete');
  });

  it('shows the model the earlier turns, without the old citation numbers', async () => {
    const conversation = await newConversation(core, ws);
    await ask(scripted(['Revenue grew [S3].']), found(source(3)), 'first', { conversation });

    const llm = scripted(['Second.']);
    await ask(llm, found(source(1)), 'second', { conversation });
    const answerRequest = llm.requests.find((r) => !r.system.includes('Rewrite'))!;

    expect(answerRequest.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(answerRequest.messages[1]?.content).toBe('Revenue grew.');
  });

  it('leaves failed answers out of what the model sees', async () => {
    const conversation = await newConversation(core, ws);
    await ask(scripted([], { fail: new LlmError('down', false) }), found(source(1)), 'broken one', {
      conversation,
    });

    const llm = scripted(['Fine.']);
    await ask(llm, found(source(1)), 'next', { conversation });
    const request = llm.requests.at(-1)!;
    expect(request.messages.map((m) => m.content).join('\n')).not.toContain('broken one');
  });

  it('sends at most the configured number of earlier messages', async () => {
    const conversation = await newConversation(core, ws);
    for (let i = 1; i <= 4; i++)
      await ask(scripted([`Answer ${i}.`]), found(source(1)), `question ${i}`, { conversation });

    const llm = scripted(['Last.']);
    await ask(llm, found(source(1)), 'question 5', {
      conversation,
      overrides: { config: { ...core.config, CHAT_HISTORY_MESSAGES: 2 } },
    });
    const request = llm.requests.find((r) => !r.system.includes('Rewrite'))!;
    // two earlier messages, then the new question
    expect(request.messages).toHaveLength(3);
    expect(request.messages[0]).toEqual({ role: 'user', content: 'question 4' });
  });
});

describe('writing an answer again', () => {
  it('replaces the last answer, asks the same question, and adds no second question', async () => {
    const conversation = await newConversation(core, ws);
    await ask(scripted(['First attempt.']), found(source(1)), 'the question', { conversation });

    const events: ChatStreamEvent[] = [];
    const message = await answer(
      { ...core, llm: scripted(['Second attempt [S1].']) },
      ws,
      conversation,
      { kind: 'regenerate' },
      new AbortController().signal,
      (e) => events.push(e),
      found(source(1)),
    );

    expect(message.content).toBe('Second attempt [S1].');
    const { messages } = await getConversation(core, ws, conversation._id);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'the question'],
      ['assistant', 'Second attempt [S1].'],
    ]);
  });

  it('can write a failed answer again, which is what Retry does', async () => {
    const conversation = await newConversation(core, ws);
    const failed = await ask(
      scripted([], { fail: new LlmError('down', true) }),
      found(source(1)),
      'retry me',
      {
        conversation,
      },
    );
    expect(failed.message.status).toBe('failed');

    const again = await answer(
      { ...core, llm: scripted(['Works now.']) },
      ws,
      conversation,
      { kind: 'regenerate' },
      new AbortController().signal,
      () => {},
      found(source(1)),
    );
    expect(again).toMatchObject({ status: 'complete', content: 'Works now.' });
    const { messages } = await getConversation(core, ws, conversation._id);
    expect(messages.map((m) => m.status)).toEqual(['complete', 'complete']);
  });

  it('refuses when there is no answer to replace', async () => {
    const conversation = await newConversation(core, ws);
    await expect(
      answer(
        { ...core, llm: scripted(['x']) },
        ws,
        conversation,
        { kind: 'regenerate' },
        new AbortController().signal,
        () => {},
        found(),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
