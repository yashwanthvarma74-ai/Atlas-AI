import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import { pino } from 'pino';
import {
  answer,
  checkCitations,
  createConversation,
  createCore,
  createWorkspace,
  loadConfig,
  loadConversation,
  mean,
  percentile,
  processDocument,
  recallAt,
  requireAccess,
  retrieve,
  uploadDocument,
  waitForSearchIndexes,
  type Core,
  type EvalMetrics,
  type EvalRun,
  type Ranks,
  type WorkspaceAccess,
} from '@atlas/core';
import { loadDataset, type Question } from './dataset';

export interface RunOptions {
  chunkTokens: number;
  overlapTokens: number;
  reranker: 'none' | 'coverage';
  // drop passages below this vector score; unset means no cutoff
  log?: (message: string) => void;
}

interface Corpus {
  access: WorkspaceAccess;
  // document name -> id, so a passage can be matched to the document it was supposed to come from
  documents: Map<string, string>;
}

async function ingest(
  core: Core,
  access: WorkspaceAccess,
  files: { name: string; text: string }[],
): Promise<Corpus> {
  const documents = new Map<string, string>();
  for (const file of files) {
    const doc = await uploadDocument(core, access, {
      name: file.name,
      bytes: new TextEncoder().encode(file.text),
    });
    await processDocument(core, {
      documentId: doc.id,
      workspaceId: access.workspaceId.toHexString(),
      userId: access.userId.toHexString(),
    });
    documents.set(file.name, doc.id);
  }
  return { access, documents };
}

const git = (...args: string[]) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

// Scores retrieval, citations, speed and cost on the benchmark.
//
// It builds its own database and its own queue, fills a workspace with the corpus and a second workspace with a
// copy of it (so a missing tenant filter has identical text to leak), asks every question, and removes
// everything afterwards. Nothing it does touches the app's data.
export async function runEval(options: RunOptions): Promise<EvalRun> {
  const log = options.log ?? (() => {});
  const { dataset, corpus: files, hash } = loadDataset();

  const suffix = randomBytes(5).toString('hex');
  const base = new URL(
    process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true',
  );
  base.pathname = `/atlas_eval_${suffix}`;
  const uploadDir = await mkdtemp(join(tmpdir(), 'atlas-eval-'));

  const config = loadConfig({
    // the in-process model the deployment uses, unless the run asks for another
    EMBEDDING_PROVIDER: 'local',
    EMBEDDING_DIMENSIONS: '384',
    ...process.env,
    NODE_ENV: 'test',
    MONGODB_URI: base.toString(),
    REDIS_PREFIX: `atlas_eval_${suffix}`,
    UPLOAD_DIR: uploadDir,
    STORAGE_DRIVER: 'local',
    CHUNK_TARGET_TOKENS: String(options.chunkTokens),
    CHUNK_OVERLAP_TOKENS: String(options.overlapTokens),
    RERANKER: options.reranker,
  });
  const core = await createCore(config, { logger: pino({ level: 'silent' }) });

  try {
    // The search service of a freshly started database can take a while to come up.
    for (let i = 0; !core.searchAvailable && i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await core.recheckSearch();
    }
    if (!core.searchAvailable)
      throw new Error('The database has no Atlas Search. Start one with docker compose up -d.');

    const user = (name: string) => ({
      _id: new ObjectId(),
      name,
      email: `${name}@eval.test`,
      guest: false,
      createdAt: new Date(),
    });
    const [evaluator, bystander] = [user('evaluator'), user('bystander')];
    await core.database.users.insertMany([evaluator, bystander]);
    const open = async (owner: typeof evaluator) => {
      const workspace = await createWorkspace(core, owner, { name: `Eval ${owner.name}` });
      return requireAccess(core, owner._id, new ObjectId(workspace.id), 'owner');
    };

    log(
      `Ingesting ${files.length} documents twice (chunks of ${options.chunkTokens} tokens, ${options.overlapTokens} overlap)...`,
    );
    const main = await ingest(core, await open(evaluator), files);
    const decoy = await ingest(core, await open(bystander), files);
    await Promise.all([main, decoy].map((c) => waitForSearchIndexes(core, c.access.workspaceId)));
    const mine = new Set(main.documents.values());
    const chunkCount = await core.database.chunks.countDocuments({
      workspaceId: main.access.workspaceId,
    });

    // ---- retrieval ----
    log(`Searching ${dataset.questions.length} questions over ${chunkCount} passages...`);
    const ranks: { question: Question; rank: number | null }[] = [];
    const retrievalMs: number[] = [];
    let crossWorkspaceHits = 0;

    for (const question of dataset.questions) {
      const started = performance.now();
      const sources = await retrieve(core, main.access, question.text, { limit: 10 });
      retrievalMs.push(performance.now() - started);
      crossWorkspaceHits += sources.filter((s) => !mine.has(s.documentId)).length;

      const index = sources.findIndex(
        (s) => s.documentName === question.document && s.text.includes(question.span),
      );
      ranks.push({ question, rank: index === -1 ? null : index + 1 });
    }
    const all: Ranks = ranks.map((r) => r.rank);
    const ofKind = (kind: Question['kind']): Ranks =>
      ranks.filter((r) => r.question.kind === kind).map((r) => r.rank);

    // ---- answers: speed, tokens, cost and citations ----
    log('Writing an answer to each question...');
    const ttft: number[] = [];
    const total: number[] = [];
    const inputTokens: number[] = [];
    const outputTokens: number[] = [];
    const costs: number[] = [];
    let costUnknown = false;
    let checked = 0;
    let supported = 0;

    for (const question of dataset.questions) {
      const created = await createConversation(core, main.access);
      const conversation = await loadConversation(
        core,
        main.access,
        new ObjectId(created.id),
        'write',
      );
      const message = await answer(
        core,
        main.access,
        conversation,
        { kind: 'ask', question: question.text },
        new AbortController().signal,
        () => {},
      );
      if (message.latency?.ttftMs != null) ttft.push(message.latency.ttftMs);
      if (message.latency) total.push(message.latency.totalMs);
      if (message.usage) {
        inputTokens.push(message.usage.inputTokens);
        outputTokens.push(message.usage.outputTokens);
      }
      if (message.costUsd === null) costUnknown = message.usage !== null || costUnknown;
      else costs.push(message.costUsd);

      if (message.citations.length > 0) {
        const texts = new Map<string, string>();
        for (const citation of message.citations) {
          const chunk = await core.database.chunks.findOne({
            _id: new ObjectId(citation.chunkId),
            workspaceId: main.access.workspaceId,
          });
          texts.set(citation.chunkId, chunk?.text ?? '');
        }
        const result = checkCitations(
          message.content,
          message.citations,
          (c) => texts.get(c.chunkId) ?? '',
        );
        checked += result.checked;
        supported += result.supported;
      }
    }

    const timing = (values: number[]) => ({
      p50: Math.round(percentile(values, 50)),
      p95: Math.round(percentile(values, 95)),
    });
    const metrics: EvalMetrics = {
      questions: ranks.length,
      recallAt1: recallAt(all, 1),
      recallAt5: recallAt(all, 5),
      recallAt10: recallAt(all, 10),
      recallAt10ByKind: {
        lexical: recallAt(ofKind('lexical'), 10),
        paraphrase: recallAt(ofKind('paraphrase'), 10),
      },
      citationConsistency: checked === 0 ? 1 : supported / checked,
      citationsChecked: checked,
      crossWorkspaceHits,
      retrievalMs: timing(retrievalMs),
      ttftMs: timing(ttft),
      totalMs: timing(total),
      tokensPerAnswer: {
        input: Math.round(mean(inputTokens)),
        output: Math.round(mean(outputTokens)),
      },
      costPerAnswerUsd: costUnknown || costs.length === 0 ? null : mean(costs),
    };

    return {
      commit: process.env.GITHUB_SHA?.slice(0, 7) ?? git('rev-parse', '--short', 'HEAD'),
      dirty: git('status', '--porcelain') !== '',
      createdAt: new Date().toISOString(),
      datasetHash: hash,
      config: {
        chunkTokens: options.chunkTokens,
        overlapTokens: options.overlapTokens,
        reranker: options.reranker,
        embedder: `${core.embedder.provider}:${core.embedder.model}`,
        llm: `${core.llm.provider}:${core.llm.model}`,
        passages: chunkCount,
      },
      metrics,
    };
  } finally {
    await core.database.db.dropDatabase().catch(() => undefined);
    await core.queues.ingest.obliterate({ force: true }).catch(() => undefined);
    await core.close();
    await rm(uploadDir, { recursive: true, force: true });
  }
}
