import { Router, type Request, type Response } from 'express';
import {
  formatSse,
  sendMessageInputSchema,
  updateConversationInputSchema,
  type ChatStreamEvent,
} from '@atlas/shared';
import {
  answer,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  loadConversation,
  updateConversation,
  type AnswerInput,
  type Core,
} from '@atlas/core';
import { idParam, limit, parse, workspaceAccess } from '../http';
import { requireUser } from '../middleware';

const HEARTBEAT_MS = 15_000;

// Mounted at /workspaces/:id/conversations. Anyone who can see the workspace may chat in it, viewers
// included; what a conversation lets them do is decided per conversation in @atlas/core.
export function conversationsRouter(core: Core): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);

  const writes = limit(core.config, 60 * 1000, 60);
  // every answer is a search, an embedding and a model call, so they are the costliest route there is
  const answers = limit(core.config, 60 * 1000, 20);

  router.get('/', async (req, res) => {
    const access = await workspaceAccess(core, req);
    const search = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : undefined;
    res.json({ conversations: await listConversations(core, access, search) });
  });

  router.post('/', writes, async (req, res) => {
    const access = await workspaceAccess(core, req);
    res.status(201).json({ conversation: await createConversation(core, access) });
  });

  router.get('/:cid', async (req, res) => {
    const access = await workspaceAccess(core, req);
    res.json(await getConversation(core, access, idParam(req, 'cid', 'That conversation')));
  });

  router.patch('/:cid', writes, async (req, res) => {
    const access = await workspaceAccess(core, req);
    const changes = parse(updateConversationInputSchema, req.body);
    res.json({
      conversation: await updateConversation(
        core,
        access,
        idParam(req, 'cid', 'That conversation'),
        changes,
      ),
    });
  });

  router.delete('/:cid', writes, async (req, res) => {
    const access = await workspaceAccess(core, req);
    await deleteConversation(core, access, idParam(req, 'cid', 'That conversation'));
    res.status(204).end();
  });

  router.post('/:cid/messages', answers, async (req, res) => {
    const { content } = parse(sendMessageInputSchema, req.body);
    await stream(core, req, res, { kind: 'ask', question: content });
  });

  // Writes the last answer again: what Regenerate does on a good answer and Retry on a failed one.
  router.post('/:cid/regenerate', answers, async (req, res) => {
    await stream(core, req, res, { kind: 'regenerate' });
  });

  return router;
}

// Runs one answer and writes its progress as Server-Sent Events.
//
// The response only becomes a stream when the first event is ready. Everything that can refuse the request
// (not signed in, no such conversation, someone else's, another answer in progress) happens before that,
// so it comes back as a normal error with a normal status code. After it, every outcome is an event.
async function stream(core: Core, req: Request, res: Response, input: AnswerInput): Promise<void> {
  const access = await workspaceAccess(core, req);
  const conversation = await loadConversation(
    core,
    access,
    idParam(req, 'cid', 'That conversation'),
    'write',
  );

  // Pressing Stop closes the connection, and that is the only signal the server gets. The answer carries on
  // far enough to save the words that have arrived, so the abort goes to the model and not to the saving.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  let heartbeat: NodeJS.Timeout | undefined;
  const emit = (event: ChatStreamEvent) => {
    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        // no-transform keeps compression from holding the words back until a buffer fills
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // tells nginx-style proxies not to buffer the stream
        'X-Accel-Buffering': 'no',
      });
      // a comment line now and then stops idle-connection timeouts from cutting a slow answer short
      heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    }
    res.write(formatSse(event.type, event));
  };

  try {
    await answer(core, access, conversation, input, controller.signal, emit);
  } finally {
    clearInterval(heartbeat);
    if (res.headersSent) res.end();
  }
}
