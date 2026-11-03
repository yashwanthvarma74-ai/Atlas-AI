import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { connect, ensureIndexes, type Database } from '@atlas/core';

// Prints how MongoDB runs every query the API makes on a filter or a sort, so that a query without an index shows
// up as a number rather than as a slow page. Runs on a throwaway database with enough rows for the planner to have
// something to choose between, and removes it afterwards.
//
//   npm run explain -w @atlas/eval        (needs `docker compose up -d`)

const WORKSPACES = 40;
const PER_WORKSPACE = 50;

interface Stage {
  stage: string;
  indexName?: string;
  inputStage?: Stage;
  inputStages?: Stage[];
}

const chain = (plan: Stage): string[] => [
  plan.stage + (plan.indexName ? ` (${plan.indexName})` : ''),
  ...(plan.inputStage ? chain(plan.inputStage) : []),
  ...(plan.inputStages ? plan.inputStages.flatMap(chain) : []),
];

async function seed(d: Database): Promise<{
  workspaceId: ObjectId;
  userId: ObjectId;
  conversationId: ObjectId;
  documentId: ObjectId;
}> {
  const userId = new ObjectId();
  const conversationId = new ObjectId();
  const documentId = new ObjectId();
  const workspaceIds = Array.from({ length: WORKSPACES }, (_, i) =>
    i === 0 ? new ObjectId() : new ObjectId(),
  );
  const when = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 60_000);
  for (const [w, workspaceId] of workspaceIds.entries()) {
    await d.memberships.insertMany(
      Array.from({ length: 5 }, (_, i) => ({
        _id: new ObjectId(),
        workspaceId,
        userId: i === 0 && w === 0 ? userId : new ObjectId(),
        role: 'editor' as const,
        createdAt: when(i),
      })),
    );
    await d.documents.insertMany(
      Array.from({ length: PER_WORKSPACE }, (_, i) => ({
        _id: i === 0 && w === 0 ? documentId : new ObjectId(),
        workspaceId,
        name: `doc-${i}.txt`,
        kind: 'text' as const,
        mimeType: 'text/plain',
        size: 100,
        storageKey: `k/${w}/${i}`,
        status: 'indexed' as const,
        error: null,
        pageCount: 1,
        chunkCount: 4,
        uploadedBy: userId,
        createdAt: when(i),
        updatedAt: when(i),
      })),
    );
    await d.conversations.insertMany(
      Array.from({ length: PER_WORKSPACE }, (_, i) => ({
        _id: i === 0 && w === 0 ? conversationId : new ObjectId(),
        workspaceId,
        userId: i % 2 ? userId : new ObjectId(),
        title: `Conversation ${i}`,
        visibility: (i % 3 ? 'private' : 'workspace') as 'private' | 'workspace',
        createdAt: when(i),
        updatedAt: when(i),
      })),
    );
    await d.toolCalls.insertMany(
      Array.from(
        { length: PER_WORKSPACE },
        (_, i) =>
          ({
            _id: new ObjectId(),
            workspaceId,
            conversationId: i === 0 && w === 0 ? conversationId : new ObjectId(),
            proposedBy: userId,
            createdAt: when(i),
          }) as never,
      ),
    );
  }
  const workspaceId = workspaceIds[0]!;
  await d.messages.insertMany(
    Array.from(
      { length: 400 },
      (_, i) =>
        ({
          _id: new ObjectId(),
          conversationId: i < 40 ? conversationId : new ObjectId(),
          workspaceId,
          role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
          content: `message ${i}`,
          status: 'complete' as const,
          createdAt: when(i),
        }) as never,
    ),
  );
  await d.chunks.insertMany(
    Array.from(
      { length: 4000 },
      (_, i) =>
        ({
          _id: new ObjectId(),
          workspaceId,
          documentId: i < 8 ? documentId : new ObjectId(),
          ord: i < 8 ? i : 0,
          page: 1,
          text: `chunk ${i}`,
          tokenCount: 4,
          embedding: [0],
          embeddingModel: 'x',
        }) as never,
    ),
  );
  return { workspaceId, userId, conversationId, documentId };
}

async function main() {
  const base = new URL(
    process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true',
  );
  base.pathname = `/atlas_explain_${randomBytes(4).toString('hex')}`;
  const d = await connect(base.toString());
  try {
    await ensureIndexes(d);
    const { workspaceId, userId, conversationId, documentId } = await seed(d);

    const queries: [string, () => Promise<unknown>][] = [
      [
        'Access check on every request: memberships by workspace and user',
        () => d.memberships.find({ workspaceId, userId }).explain('executionStats'),
      ],
      [
        '"My workspaces": memberships by user, oldest first',
        () => d.memberships.find({ userId }).sort({ createdAt: 1 }).explain('executionStats'),
      ],
      [
        'Member list: memberships of one workspace, oldest first',
        () => d.memberships.find({ workspaceId }).sort({ createdAt: 1 }).explain('executionStats'),
      ],
      [
        'Document library: one workspace, newest first',
        () =>
          d.documents
            .find({ workspaceId })
            .sort({ createdAt: -1, _id: -1 })
            .explain('executionStats'),
      ],
      [
        'Requeue sweep: queued documents not touched lately',
        () =>
          d.documents
            .find({ status: 'queued', updatedAt: { $lt: new Date() } })
            .limit(100)
            .explain('executionStats'),
      ],
      [
        'Passages of a page, in order',
        () =>
          d.chunks
            .find({ documentId, workspaceId, page: 1 })
            .sort({ ord: 1 })
            .explain('executionStats'),
      ],
      [
        'Delete or re-process a document: its chunks',
        () => d.chunks.find({ documentId, workspaceId }).explain('executionStats'),
      ],
      [
        'History: my conversations, newest first',
        () =>
          d.conversations
            .find({ workspaceId, userId })
            .sort({ updatedAt: -1, _id: -1 })
            .explain('executionStats'),
      ],
      [
        'History: conversations shared with the workspace',
        () =>
          d.conversations
            .find({ workspaceId, visibility: 'workspace' })
            .sort({ updatedAt: -1, _id: -1 })
            .explain('executionStats'),
      ],
      [
        'A conversation, oldest message first',
        () =>
          d.messages
            .find({ conversationId, workspaceId })
            .sort({ createdAt: 1, _id: 1 })
            .explain('executionStats'),
      ],
      [
        'Recent messages for the prompt, newest first',
        () =>
          d.messages
            .find({ conversationId, workspaceId })
            .sort({ createdAt: -1, _id: -1 })
            .limit(16)
            .explain('executionStats'),
      ],
      [
        'Tool calls in a conversation',
        () =>
          d.toolCalls
            .find({ conversationId, workspaceId })
            .sort({ createdAt: 1, _id: 1 })
            .explain('executionStats'),
      ],
      [
        'Audit trail (owner): the workspace, newest first',
        () =>
          d.toolCalls
            .find({ workspaceId })
            .sort({ createdAt: -1, _id: -1 })
            .limit(200)
            .explain('executionStats'),
      ],
      [
        'Audit trail (anyone else): their own, newest first',
        () =>
          d.toolCalls
            .find({ workspaceId, proposedBy: userId })
            .sort({ createdAt: -1, _id: -1 })
            .limit(200)
            .explain('executionStats'),
      ],
      [
        'Evaluation dashboard: runs, newest first',
        () => d.evalRuns.find().sort({ createdAt: -1 }).limit(20).explain('executionStats'),
      ],
    ];

    const rows: string[] = [
      '| Query | Plan | Keys examined | Docs examined | Returned |',
      '| --- | --- | ---: | ---: | ---: |',
    ];
    let bad = 0;
    for (const [name, run] of queries) {
      const result = (await run()) as {
        queryPlanner: { winningPlan: Stage };
        executionStats: { totalKeysExamined: number; totalDocsExamined: number; nReturned: number };
      };
      const plan = chain(result.queryPlanner.winningPlan);
      const { totalKeysExamined: keys, totalDocsExamined: docs, nReturned } = result.executionStats;
      // a collection scan or a sort in memory is what an index is there to prevent
      const flag = plan.some((s) => s.startsWith('COLLSCAN') || s.startsWith('SORT')) ? ' ⚠' : '';
      if (flag) bad++;
      rows.push(`| ${name} | ${plan.join(' → ')}${flag} | ${keys} | ${docs} | ${nReturned} |`);
    }
    console.log(rows.join('\n'));
    console.log(
      `\n${bad === 0 ? 'Every query uses an index and none sorts in memory.' : `${bad} query plan(s) scan a collection or sort in memory (marked ⚠).`}`,
    );
    process.exitCode = bad === 0 ? 0 : 1;
  } finally {
    await d.db.dropDatabase();
    await d.client.close();
  }
}

await main();
