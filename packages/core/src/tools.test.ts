import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  decideToolCall,
  listAuditTrail,
  listConversationToolCalls,
  proposeToolCalls,
  updateConversation,
  type ToolDefinition,
  type ToolRegistry,
  type UserDoc,
  type WorkspaceAccess,
} from './index';
import { createTestCore, type TestCore } from './test/context';
import { newConversation } from './test/chat';

let core: TestCore;
let ws: WorkspaceAccess;
let owner: UserDoc;
beforeAll(async () => {
  core = await createTestCore();
  owner = await core.user('owner@tools.test', { name: 'Olivia' });
  ws = await core.workspace(owner);
});
afterAll(() => core.destroy());

const note = (title = 'Q3 summary', text = 'Revenue grew.') =>
  JSON.stringify({ tool: 'save_note', args: { title, text } });

async function propose(
  raw: string[],
  access = ws,
  conversation?: Awaited<ReturnType<typeof newConversation>>,
) {
  const c = conversation ?? (await newConversation(core, access));
  const docs = await proposeToolCalls(
    core,
    access,
    c._id,
    new ObjectId(),
    raw.map((r) => ({ raw: r })),
  );
  return { docs, conversation: c };
}

describe('proposing', () => {
  it('records a valid request as waiting for a person, with a line saying what approving does', async () => {
    const { docs } = await propose([note()]);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      tool: 'save_note',
      status: 'proposed',
      description: 'Save a note called "Q3 summary" in this workspace',
      decidedBy: null,
      error: null,
    });
    // proposing changes nothing: no document exists yet
    expect(await core.database.documents.countDocuments({ name: 'Q3 summary.md' })).toBe(0);
  });

  it('keeps a request that cannot be run, marked invalid, so the audit trail shows it', async () => {
    const first = await propose([
      'not json at all',
      '[1, 2]',
      JSON.stringify({ tool: 'save_note' }),
    ]);
    const second = await propose([
      JSON.stringify({ tool: 'drop_database', args: {} }),
      JSON.stringify({ tool: 'save_note', args: { title: '', text: 'x' } }),
      JSON.stringify({ tool: 'save_note', args: { title: 'ok', text: 'x'.repeat(5001) } }),
    ]);

    expect([...first.docs, ...second.docs].map((d) => d.status)).toEqual(Array(6).fill('invalid'));
    expect([...first.docs, ...second.docs].map((d) => d.error)).toEqual([
      'The request was not valid JSON.',
      'The request needs a "tool" name and an "args" object.',
      'The request needs a "tool" name and an "args" object.',
      'There is no tool called "drop_database".',
      expect.stringMatching(/^The arguments were not valid: title/),
      expect.stringMatching(/^The arguments were not valid: text/),
    ]);
    // all of them were saved
    expect(
      await core.database.toolCalls.countDocuments({ conversationId: first.conversation._id }),
    ).toBe(3);
  });

  it('refuses an argument the tool does not define, instead of ignoring it', async () => {
    const { docs } = await propose([
      JSON.stringify({
        tool: 'save_note',
        args: { title: 't', text: 'x', workspaceId: 'someone-elses' },
      }),
    ]);
    expect(docs[0]).toMatchObject({ status: 'invalid' });
    expect(docs[0]?.error).toMatch(/not valid/);
  });

  it('does not look tool names up on the object prototype', async () => {
    const { docs } = await propose([
      JSON.stringify({ tool: 'constructor', args: {} }),
      JSON.stringify({ tool: '__proto__', args: {} }),
    ]);
    expect(docs.map((d) => d.status)).toEqual(['invalid', 'invalid']);
  });

  it('allows three requests in an answer and refuses the rest', async () => {
    const { docs } = await propose(Array.from({ length: 5 }, (_, i) => note(`Note ${i}`)));
    expect(docs.map((d) => d.status)).toEqual([
      'proposed',
      'proposed',
      'proposed',
      'invalid',
      'invalid',
    ]);
    expect(docs[3]?.error).toMatch(/at most 3/);
  });

  it('does not offer a tool to someone whose role does not allow it', async () => {
    const viewer = await core.user('viewer@tools.test');
    await addMember(core, ws, { email: 'viewer@tools.test', role: 'viewer' });
    const access = await core.accessFor(viewer, ws);
    const { docs } = await propose([note()], access);
    expect(docs[0]).toMatchObject({
      status: 'invalid',
      error: 'Your role in this workspace does not allow that tool.',
    });
  });

  it('runs a tool that needs no approval straight away, and records that too', async () => {
    const readOnly: ToolDefinition<{ q: string }> = {
      name: 'peek',
      description: 'reads something',
      schema: z.object({ q: z.string() }).strict(),
      approval: false,
      minRole: 'viewer',
      describe: ({ q }) => `Look up ${q}`,
      execute: async (_c, _a, { q }) => ({ summary: `Looked up ${q}` }),
    };
    const local = { ...core, tools: { peek: readOnly } as unknown as ToolRegistry };
    const c = await newConversation(core, ws);
    const docs = await proposeToolCalls(local, ws, c._id, new ObjectId(), [
      { raw: JSON.stringify({ tool: 'peek', args: { q: 'x' } }) },
    ]);

    expect(docs[0]).toMatchObject({ status: 'executed', result: { summary: 'Looked up x' } });
    expect(await core.database.toolCalls.countDocuments({ conversationId: c._id })).toBe(1);
  });
});

describe('approving', () => {
  it('runs the tool, once, as the person who approved, and records who and what', async () => {
    const { docs } = await propose([note('Board prep', 'Agree the agenda.')]);
    const result = await decideToolCall(core, ws, docs[0]!._id, 'approve');

    expect(result).toMatchObject({
      status: 'executed',
      decidedBy: owner._id.toHexString(),
      decidedByName: 'Olivia',
      result: { summary: 'Saved as "Board prep.md"' },
    });
    const saved = await core.database.documents.findOne({
      name: 'Board prep.md',
      workspaceId: ws.workspaceId,
    });
    expect(saved).toMatchObject({ kind: 'text', uploadedBy: owner._id });
    expect(new TextDecoder().decode(await core.storage.get(saved!.storageKey))).toBe(
      '# Board prep\n\nAgree the agenda.\n',
    );
    expect(result.result?.documentId).toBe(saved!._id.toHexString());
    // and it is queued for indexing like any upload
    expect(await core.queues.ingest.getJob(saved!._id.toHexString())).toBeDefined();
  });

  it('cannot be used to write outside the workspace through the title', async () => {
    const { docs } = await propose([note('../../etc/passwd', 'x')]);
    const result = await decideToolCall(core, ws, docs[0]!._id, 'approve');
    const saved = await core.database.documents.findOne({
      _id: new ObjectId(result.result!.documentId),
    });
    expect(saved?.name).toBe('.. .. etc passwd.md');
    expect(saved?.storageKey).toBe(`${ws.workspaceId.toHexString()}/${saved!._id.toHexString()}`);
  });

  it('does nothing when rejected', async () => {
    const before = await core.database.documents.countDocuments();
    const { docs } = await propose([note('Never saved')]);
    const result = await decideToolCall(core, ws, docs[0]!._id, 'reject');

    expect(result).toMatchObject({ status: 'rejected', decidedByName: 'Olivia' });
    expect(await core.database.documents.countDocuments()).toBe(before);
    await expect(decideToolCall(core, ws, docs[0]!._id, 'approve')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('runs once when two approvals arrive at the same moment', async () => {
    const { docs } = await propose([note('Only once')]);
    const attempts = await Promise.allSettled([
      decideToolCall(core, ws, docs[0]!._id, 'approve'),
      decideToolCall(core, ws, docs[0]!._id, 'approve'),
      decideToolCall(core, ws, docs[0]!._id, 'approve'),
    ]);

    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    expect(
      attempts
        .filter((a) => a.status === 'rejected')
        .map((a) => (a as PromiseRejectedResult).reason.status),
    ).toEqual([409, 409]);
    expect(await core.database.documents.countDocuments({ name: 'Only once.md' })).toBe(1);
  });

  it('cannot approve what has already been decided', async () => {
    const { docs } = await propose([note('Decided')]);
    await decideToolCall(core, ws, docs[0]!._id, 'approve');
    await expect(decideToolCall(core, ws, docs[0]!._id, 'approve')).rejects.toMatchObject({
      status: 409,
    });
    await expect(decideToolCall(core, ws, docs[0]!._id, 'reject')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('refuses to approve an invalid request', async () => {
    const { docs } = await propose([JSON.stringify({ tool: 'drop_database', args: {} })]);
    await expect(decideToolCall(core, ws, docs[0]!._id, 'approve')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('lets a request lapse: after its time it cannot be approved, and nothing runs', async () => {
    const { docs } = await propose([note('Too late')]);
    await core.database.toolCalls.updateOne(
      { _id: docs[0]!._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    await expect(decideToolCall(core, ws, docs[0]!._id, 'approve')).rejects.toMatchObject({
      status: 409,
    });
    expect(await core.database.documents.countDocuments({ name: 'Too late.md' })).toBe(0);
    expect((await core.database.toolCalls.findOne({ _id: docs[0]!._id }))?.status).toBe('expired');
  });

  it('checks the stored arguments again, so a request that was altered after it was proposed does not run', async () => {
    const { docs } = await propose([note('Tampered')]);
    await core.database.toolCalls.updateOne(
      { _id: docs[0]!._id },
      { $set: { args: { title: 'Tampered', text: 'x', extra: 'injected' } } },
    );

    const result = await decideToolCall(core, ws, docs[0]!._id, 'approve');
    expect(result).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/no longer valid/),
    });
    expect(await core.database.documents.countDocuments({ name: 'Tampered.md' })).toBe(0);
  });

  it('records a tool that fails, with a message that does not leak why', async () => {
    const broken: ToolDefinition<{ x: string }> = {
      name: 'broken',
      description: 'always fails',
      schema: z.object({ x: z.string() }).strict(),
      approval: true,
      minRole: 'viewer',
      describe: () => 'Do the broken thing',
      execute: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.9:5432 password=hunter2');
      },
    };
    const local = { ...core, tools: { broken } as unknown as ToolRegistry };
    const c = await newConversation(core, ws);
    const [doc] = await proposeToolCalls(local, ws, c._id, new ObjectId(), [
      { raw: JSON.stringify({ tool: 'broken', args: { x: 'y' } }) },
    ]);

    const result = await decideToolCall(local, ws, doc!._id, 'approve');
    expect(result.status).toBe('failed');
    expect(result.error).toBe('The tool failed. Nothing was changed.');
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  describe('who may decide', () => {
    it('lets only the author of the conversation decide, even on a conversation others can read', async () => {
      const colleague = await core.user('colleague@tools.test');
      await addMember(core, ws, { email: 'colleague@tools.test', role: 'editor' });
      const colleagueAccess = await core.accessFor(colleague, ws);
      const { docs, conversation } = await propose([note('Shared')]);

      // while the conversation is private, the colleague cannot even tell the request exists
      await expect(
        decideToolCall(core, colleagueAccess, docs[0]!._id, 'approve'),
      ).rejects.toMatchObject({ status: 404 });

      await updateConversation(core, ws, conversation._id, { visibility: 'workspace' });
      await expect(
        decideToolCall(core, colleagueAccess, docs[0]!._id, 'approve'),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        decideToolCall(core, colleagueAccess, docs[0]!._id, 'reject'),
      ).rejects.toMatchObject({ status: 403 });
      expect(await core.database.documents.countDocuments({ name: 'Shared.md' })).toBe(0);
    });

    it('does not take a request from another workspace', async () => {
      const otherOwner = await core.user('other@tools.test');
      const other = await core.workspace(otherOwner);
      const { docs } = await propose([note('Mine')]);
      await expect(decideToolCall(core, other, docs[0]!._id, 'approve')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('checks the role again at the moment of approval, not only when it was proposed', async () => {
      const demoted = await core.user('demoted@tools.test');
      await addMember(core, ws, { email: 'demoted@tools.test', role: 'editor' });
      const asEditor = await core.accessFor(demoted, ws);
      const { docs } = await propose([note('Before demotion')], asEditor);
      expect(docs[0]?.status).toBe('proposed');

      await core.database.memberships.updateOne(
        { workspaceId: ws.workspaceId, userId: demoted._id },
        { $set: { role: 'viewer' } },
      );
      const asViewer = await core.accessFor(demoted, ws);
      await expect(decideToolCall(core, asViewer, docs[0]!._id, 'approve')).rejects.toMatchObject({
        status: 403,
      });
      expect(await core.database.documents.countDocuments({ name: 'Before demotion.md' })).toBe(0);
    });
  });
});

describe('reading', () => {
  it("lists a conversation's requests in order, with who asked and who decided", async () => {
    const { docs, conversation } = await propose([note('First'), note('Second')]);
    await decideToolCall(core, ws, docs[0]!._id, 'approve');

    const calls = await listConversationToolCalls(core, ws, conversation._id);
    expect(calls.map((c) => [c.args.title, c.status, c.proposedByName, c.decidedByName])).toEqual([
      ['First', 'executed', 'Olivia', 'Olivia'],
      ['Second', 'proposed', 'Olivia', null],
    ]);
  });

  it('gives the owner every request in the audit trail, and everyone else only their own', async () => {
    const local = await createTestCore();
    try {
      const boss = await local.user('boss@audit.test');
      const bossAccess = await local.workspace(boss);
      const worker = await local.user('worker@audit.test');
      await addMember(local, bossAccess, { email: 'worker@audit.test', role: 'editor' });
      const workerAccess = await local.accessFor(worker, bossAccess);

      for (const [access, title] of [
        [bossAccess, 'From the owner'],
        [workerAccess, 'From the editor'],
      ] as const) {
        const c = await newConversation(local, access);
        await proposeToolCalls(local, access, c._id, new ObjectId(), [
          { raw: note(title) },
          { raw: 'garbage' },
        ]);
      }

      const seenByOwner = await listAuditTrail(local, bossAccess);
      const seenByEditor = await listAuditTrail(local, workerAccess);
      expect(seenByOwner).toHaveLength(4);
      expect(seenByEditor).toHaveLength(2);
      expect(seenByEditor.every((c) => c.proposedByName === 'worker')).toBe(true);
      // refused requests are in it too
      expect(seenByOwner.filter((c) => c.status === 'invalid')).toHaveLength(2);
    } finally {
      await local.destroy();
    }
  });

  it('puts the newest first', async () => {
    const trail = await listAuditTrail(core, ws);
    const times = trail.map((c) => c.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });
});
