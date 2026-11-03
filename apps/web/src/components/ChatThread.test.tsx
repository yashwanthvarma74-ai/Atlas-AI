import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatSse,
  type ChatStreamEvent,
  type Conversation,
  type Message,
  type ToolCall,
} from '@atlas/shared';
import { expectNoAxeViolations, json, renderWithProviders } from '@/test/render';
import ChatThread from './ChatThread';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const me = { id: 'u1', name: 'Olivia', email: 'o@x.test', guest: false };
const conversation = (fields: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  title: 'Revenue questions',
  visibility: 'private',
  authorId: 'u1',
  authorName: 'Olivia',
  mine: true,
  createdAt: '2026-11-03T00:00:00.000Z',
  updatedAt: '2026-11-03T00:00:00.000Z',
  ...fields,
});
const message = (fields: Partial<Message>): Message => ({
  id: 'm1',
  role: 'assistant',
  content: 'Revenue grew [S1].',
  status: 'complete',
  error: null,
  citations: [
    {
      n: 1,
      chunkId: 'k1',
      documentId: 'd1',
      documentName: 'report.pdf',
      page: 3,
      quote: 'Revenue grew',
    },
  ],
  usage: { inputTokens: 100, outputTokens: 12 },
  costUsd: 0.0003,
  latency: { retrievalMs: 80, ttftMs: 410, totalMs: 1900 },
  createdAt: '2026-11-03T00:00:00.000Z',
  ...fields,
});
const asked = (content: string, id = 'q1'): Message =>
  message({ id, role: 'user', content, citations: [], usage: null, costUsd: null, latency: null });

// A streaming response the test feeds by hand, so it can look at the screen between two words.
function liveStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    send: (event: ChatStreamEvent) =>
      controller.enqueue(new TextEncoder().encode(formatSse(event.type, event))),
    close: () => controller.close(),
    fail: () => controller.error(new DOMException('aborted', 'AbortError')),
  };
}

interface Setup {
  conversation?: Conversation;
  messages?: Message[];
  toolCalls?: ToolCall[];
  role?: 'owner' | 'editor' | 'viewer';
  onPost?: (url: string, init: RequestInit) => Response | Promise<Response>;
  onDecide?: (decision: 'approve' | 'reject') => Response | Promise<Response>;
}

// Routes the few requests a thread makes. The conversation is a mutable value, so a refetch after a Stop
// can return what "the server" saved in the meantime.
const proposal = (fields: Partial<ToolCall> = {}): ToolCall => ({
  id: 't1',
  conversationId: 'c1',
  messageId: 'm1',
  tool: 'save_note',
  args: { title: 'Q3 summary', text: 'Revenue grew 14 percent.' },
  description: 'Save a note called "Q3 summary" in this workspace',
  status: 'proposed',
  proposedBy: 'u1',
  proposedByName: 'Olivia',
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  result: null,
  error: null,
  createdAt: '2026-11-03T00:00:00.000Z',
  expiresAt: '2026-11-03T01:00:00.000Z',
  ...fields,
});

function setup({ messages = [], toolCalls = [], role = 'owner', ...rest }: Setup = {}) {
  const state = { conversation: rest.conversation ?? conversation(), messages, toolCalls };
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/auth/me')) return json(200, { user: me });
    if (init?.method === 'POST' && /\/tool-calls\//.test(url)) {
      const { decision } = JSON.parse(init.body as string);
      return rest.onDecide?.(decision) ?? json(500);
    }
    if (/\/workspaces\/w1$/.test(url))
      return json(200, { workspace: { id: 'w1', name: 'W', role, createdAt: '' } });
    if (init?.method === 'POST' && /\/(messages|regenerate)$/.test(url)) {
      return rest.onPost?.(url, init) ?? json(500);
    }
    if (init?.method === 'PATCH') {
      const changes = JSON.parse(init.body as string);
      state.conversation = { ...state.conversation, ...changes };
      return json(200, { conversation: state.conversation });
    }
    if (init?.method === 'DELETE') return json(204);
    if (url.includes('/passages')) return json(200, { passages: [] });
    return json(200, {
      conversation: state.conversation,
      messages: state.messages,
      toolCalls: state.toolCalls,
    });
  });
  const view = renderWithProviders(<ChatThread workspaceId="w1" conversationId="c1" />);
  return { state, calls, ...view };
}

beforeEach(() => push.mockClear());

describe('ChatThread', () => {
  it('shows the saved messages with their citations, timings and tokens', async () => {
    const { container } = setup({ messages: [asked('How did revenue grow?'), message({})] });

    expect(await screen.findByText('How did revenue grow?')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Source S1: report.pdf, page 3' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/First word in 410 ms · 1\.9 s · 12 tokens · \$0\.0003/),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('shows the question at once, then the words as they arrive, then the saved answer', async () => {
    const live = liveStream();
    const { state } = setup({ onPost: () => live.response });
    await screen.findByLabelText('Your question');

    await userEvent.type(screen.getByLabelText('Your question'), 'How did revenue grow?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    // before the server has said anything
    expect(await screen.findByText('How did revenue grow?')).toBeInTheDocument();
    expect(screen.getByText('Searching your documents…')).toBeInTheDocument();
    expect(screen.getByLabelText('Your question')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    act(() => {
      live.send({ type: 'start', userMessageId: 'q9', assistantMessageId: 'a9' });
      live.send({ type: 'sources', sources: [{ n: 1, documentName: 'report.pdf', page: 3 }] });
    });
    expect(await screen.findByText(/Found 1 passage/)).toBeInTheDocument();

    act(() => live.send({ type: 'token', text: 'Revenue grew' }));
    expect(await screen.findByText('Revenue grew')).toBeInTheDocument();
    expect(screen.getByText(/First word in/)).toBeInTheDocument();

    const final = message({ id: 'a9', content: 'Revenue grew [S1].' });
    // the server saves the pair, so the refetch that follows a finished answer returns it
    state.messages = [asked('How did revenue grow?', 'q9'), final];
    act(() => {
      live.send({ type: 'token', text: ' [S1].' });
      live.send({ type: 'done', message: final, toolCalls: [] });
      live.close();
    });

    expect(
      await screen.findByRole('button', { name: 'Source S1: report.pdf, page 3' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    // the question is still there, from the cache and not from a second request
    expect(screen.getByText('How did revenue grow?')).toBeInTheDocument();
  });

  it('sends the question as JSON to the messages endpoint', async () => {
    const live = liveStream();
    const { calls } = setup({ onPost: () => live.response });
    await screen.findByLabelText('Your question');
    await userEvent.type(screen.getByLabelText('Your question'), 'costs?{Enter}');

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/conversations/c1/messages'))).toBe(true),
    );
    const post = calls.find((c) => c.url.endsWith('/messages'))!;
    expect(JSON.parse(post.init!.body as string)).toEqual({ content: 'costs?' });
  });

  it('starts a new line on Shift+Enter instead of sending', async () => {
    const { calls } = setup();
    await screen.findByLabelText('Your question');
    await userEvent.type(screen.getByLabelText('Your question'), 'one{Shift>}{Enter}{/Shift}two');

    expect(screen.getByLabelText('Your question')).toHaveValue('one\ntwo');
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('cancels the request when Stop is pressed, and shows what the server saved', async () => {
    const live = liveStream();
    const saved = [
      asked('Long one?'),
      message({ id: 'a1', content: 'Partial words', status: 'stopped', citations: [] }),
    ];
    const { state, calls } = setup({
      onPost: (_url, init) => {
        init.signal!.addEventListener('abort', () => live.fail());
        return live.response;
      },
    });
    await screen.findByLabelText('Your question');
    await userEvent.type(screen.getByLabelText('Your question'), 'Long one?{Enter}');
    await screen.findByRole('button', { name: 'Stop' });
    act(() => {
      live.send({ type: 'start', userMessageId: 'q1', assistantMessageId: 'a1' });
      live.send({ type: 'token', text: 'Partial words' });
    });
    await screen.findByText('Partial words');

    state.messages = saved; // what the server stored when it saw the connection close
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(calls.find((c) => c.url.endsWith('/messages'))!.init!.signal!.aborted).toBe(true);
    expect(await screen.findByText('You stopped this answer.')).toBeInTheDocument();
    expect(screen.getByText('Partial words')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('puts the question back and says why when the server turns it down', async () => {
    setup({
      onPost: () =>
        json(409, {
          error: {
            code: 'conflict',
            message: 'An answer is already being written for this conversation.',
          },
        }),
    });
    await screen.findByLabelText('Your question');
    await userEvent.type(screen.getByLabelText('Your question'), 'try again{Enter}');

    expect(
      await screen.findByText('An answer is already being written for this conversation.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Your question')).toHaveValue('try again');
    expect(screen.queryByText('Searching your documents…')).not.toBeInTheDocument();
  });

  it('shows a failed answer with its reason, and offers Retry on the last one', async () => {
    const live = liveStream();
    const { calls } = setup({
      messages: [
        asked('q'),
        message({
          status: 'failed',
          error: 'The model took too long to answer. Try again.',
          content: '',
          citations: [],
          latency: null,
          usage: null,
        }),
      ],
      onPost: () => live.response,
    });

    expect(
      await screen.findByText('The model took too long to answer. Try again.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/conversations/c1/regenerate'))).toBe(true),
    );
    // while it runs, the failed answer is hidden and its replacement is shown as pending
    expect(await screen.findByText('Searching your documents…')).toBeInTheDocument();
    expect(
      screen.queryByText('The model took too long to answer. Try again.'),
    ).not.toBeInTheDocument();
  });

  it('shares and unshares the conversation', async () => {
    const { calls } = setup({ messages: [asked('q'), message({})] });
    await userEvent.click(await screen.findByRole('switch', { name: 'Share with workspace' }));

    await waitFor(() => {
      const patch = calls.find((c) => c.init?.method === 'PATCH')!;
      expect(JSON.parse(patch.init!.body as string)).toEqual({ visibility: 'workspace' });
    });
  });

  it("lets someone read a colleague's shared conversation but not add to it", async () => {
    setup({
      conversation: conversation({ mine: false, authorName: 'Eddie', visibility: 'workspace' }),
      messages: [asked('q'), message({})],
    });

    expect(await screen.findByText('Shared by Eddie')).toBeInTheDocument();
    expect(screen.getByText(/Only Eddie can add to it/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your question')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Share with workspace' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Retry|Regenerate|Delete/ }),
    ).not.toBeInTheDocument();
  });

  it('opens the cited passage in context', async () => {
    setup({ messages: [asked('q'), message({})] });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Source S1: report.pdf, page 3' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('report.pdf, page 3')).toBeInTheDocument();
  });

  it('asks before deleting, then goes back to the list', async () => {
    const { calls } = setup({ messages: [asked('q'), message({})] });
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/w/w1/chat'));
  });

  it('says so when the conversation is private to someone else', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).endsWith('/auth/me')
        ? json(200, { user: me })
        : json(404, { error: { code: 'not_found', message: 'That conversation was not found.' } }),
    );
    renderWithProviders(<ChatThread workspaceId="w1" conversationId="c1" />);
    expect(await screen.findByText('Conversation not found')).toBeInTheDocument();
  });

  it('keeps one broken message from taking the whole conversation down', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // content that is not a string makes the renderer throw
    const broken = {
      ...message({ id: 'bad' }),
      content: { not: 'a string' },
    } as unknown as Message;
    setup({ messages: [asked('first question'), broken, asked('second question', 'q2')] });

    expect(await screen.findByText('This message could not be shown')).toBeInTheDocument();
    expect(screen.getByText('first question')).toBeInTheDocument();
    expect(screen.getByText('second question')).toBeInTheDocument();
    spy.mockRestore();
  });

  describe('requests from the assistant', () => {
    const saved = [asked('save that'), message({})];

    it('shows exactly what will be done, and waits for a decision', async () => {
      const { container } = setup({ messages: saved, toolCalls: [proposal()] });

      expect(
        await screen.findByText('Save a note called "Q3 summary" in this workspace'),
      ).toBeInTheDocument();
      expect(screen.getByText('Waiting for you')).toBeInTheDocument();
      expect(screen.getByText('Revenue grew 14 percent.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
      await expectNoAxeViolations(container);
    });

    it('approves it, then shows how it ended', async () => {
      const { calls } = setup({
        messages: saved,
        toolCalls: [proposal()],
        onDecide: () =>
          json(200, {
            toolCall: proposal({
              status: 'executed',
              decidedByName: 'Olivia',
              result: { summary: 'Saved as "Q3 summary.md"' },
            }),
          }),
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));

      expect(await screen.findByText(/Saved as "Q3 summary\.md" by Olivia/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
      const post = calls.find((c) => c.url.endsWith('/tool-calls/t1'))!;
      expect(JSON.parse(post.init!.body as string)).toEqual({ decision: 'approve' });
    });

    it('rejects it, and says that nothing was changed', async () => {
      setup({
        messages: saved,
        toolCalls: [proposal()],
        onDecide: () =>
          json(200, { toolCall: proposal({ status: 'rejected', decidedByName: 'Olivia' }) }),
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
      expect(
        await screen.findByText(/Rejected by Olivia\. Nothing was changed\./),
      ).toBeInTheDocument();
    });

    it('shows the reason when somebody else decided first', async () => {
      setup({
        messages: saved,
        toolCalls: [proposal()],
        onDecide: () =>
          json(409, {
            error: { code: 'conflict', message: 'That request has already been decided.' },
          }),
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
      expect(await screen.findByText('That request has already been decided.')).toBeInTheDocument();
    });

    it('gives no buttons to someone who cannot decide it', async () => {
      setup({
        conversation: conversation({ mine: false, authorName: 'Eddie', visibility: 'workspace' }),
        messages: saved,
        toolCalls: [proposal()],
      });
      expect(await screen.findByText('Waiting for you')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Approve|Reject/ })).not.toBeInTheDocument();
      expect(screen.getByText('Only the person who asked can approve this.')).toBeInTheDocument();
    });

    it('gives no buttons to a viewer, whose role cannot use the tool', async () => {
      setup({ messages: saved, toolCalls: [proposal()], role: 'viewer' });
      expect(await screen.findByText('Waiting for you')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    });

    it('shows a request that was refused as refused, with why, and nothing to approve', async () => {
      setup({
        messages: saved,
        toolCalls: [
          proposal({
            status: 'invalid',
            tool: 'drop_database',
            description: '',
            args: {},
            error: 'There is no tool called "drop_database".',
          }),
        ],
      });
      expect(
        await screen.findByText('There is no tool called "drop_database".'),
      ).toBeInTheDocument();
      expect(screen.getByText('Not valid')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    });

    it('shows what a model wrote as text, even if it looks like markup', async () => {
      const { container } = setup({
        messages: saved,
        toolCalls: [
          proposal({
            args: { title: '<img src=x onerror=alert(1)>', text: '<script>alert(1)</script>' },
          }),
        ],
      });
      expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('script')).toBeNull();
    });

    it('hides a request that is still arriving, and the request itself, from the words', async () => {
      const live = liveStream();
      setup({ onPost: () => live.response });
      await screen.findByLabelText('Your question');
      await userEvent.type(screen.getByLabelText('Your question'), 'save that{Enter}');
      await screen.findByText('Searching your documents…');

      act(() => {
        live.send({ type: 'start', userMessageId: 'q9', assistantMessageId: 'a9' });
        live.send({ type: 'sources', sources: [] });
        live.send({ type: 'token', text: 'Saving it. <tool_call>{"tool":"save_not' });
      });
      expect(await screen.findByText('Saving it.')).toBeInTheDocument();
      expect(screen.queryByText(/tool_call|save_not/)).not.toBeInTheDocument();
    });
  });
});
