import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseSse, type Citation } from '@atlas/shared';
import { checkCitations, percentile, recallAt, type Ranks } from '@atlas/core';
import { DATA_DIR, loadDataset } from './dataset';

// The benchmark, run against a deployment through its public API, as a guest. It measures what only a deployment
// can: the real answer model's time to first word, its citations and its cost, the real network, the real host. The
// deployment's keys never leave it.
//
//   npm run remote -w @atlas/eval -- --url https://atlas-ai-seven-vert.vercel.app --answers 40
//
// It is paced under the API's per-address limits (30 searches and 20 answers a minute), so it takes a while. The
// search endpoint returns the top 8 passages, so retrieval is reported as recall@8 here.

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    answers: { type: 'string', default: '40' },
  },
});
if (!values.url) {
  console.error('Usage: remote --url <the web app address> [--answers N]');
  process.exit(2);
}
const SITE = values.url.replace(/\/$/, '');
const API = `${SITE}/api`;
const SEARCH_GAP_MS = 2_200;
const ANSWER_GAP_MS = 3_200;

type Quoted = Citation & { quote: string };

let cookie = '';
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Origin: SITE,
      ...(init.headers as Record<string, string>),
      ...(cookie ? { cookie } : {}),
    },
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  return res;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok)
    throw new Error(`${res.url} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message: string) => console.error(message);
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const { dataset, hash } = loadDataset();

log(`Signing in as a guest at ${SITE}...`);
await json(await call('/auth/guest', { method: 'POST' }));
const { workspaces } = await json<{ workspaces: { id: string }[] }>(await call('/workspaces'));
const ws = workspaces[0]!.id;

// ---- ingest ----
const names = [...new Set(dataset.questions.map((q) => q.document))].sort();
log(`Uploading ${names.length} documents...`);
const uploadStarted = Date.now();
for (const name of names) {
  await json(
    await call(`/workspaces/${ws}/documents?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: readFileSync(join(DATA_DIR, 'corpus', name)),
    }),
  );
}
for (;;) {
  const { documents } = await json<{ documents: { status: string }[] }>(
    await call(`/workspaces/${ws}/documents`),
  );
  const finished = documents.filter((d) => d.status === 'indexed' || d.status === 'failed');
  if (finished.length === documents.length) {
    const failed = documents.filter((d) => d.status === 'failed').length;
    if (failed > 0) throw new Error(`${failed} documents failed to index.`);
    break;
  }
  await pause(5_000);
}
const ingestSeconds = Math.round((Date.now() - uploadStarted) / 1000);
log(`Indexed in ${ingestSeconds} s. Waiting for search to catch up...`);
for (let i = 0; i < 30; i++) {
  const { sources } = await json<{ sources: unknown[] }>(
    await call(`/workspaces/${ws}/search`, post({ query: dataset.questions[0]!.text })),
  );
  if (sources.length > 0) break;
  await pause(SEARCH_GAP_MS);
}

// ---- retrieval ----
log(`Searching ${dataset.questions.length} questions...`);
const ranks: { kind: string; rank: number | null }[] = [];
const searchMs: number[] = [];
for (const question of dataset.questions) {
  const started = performance.now();
  const { sources } = await json<{ sources: { documentName: string; text: string }[] }>(
    await call(`/workspaces/${ws}/search`, post({ query: question.text })),
  );
  searchMs.push(performance.now() - started);
  const index = sources.findIndex(
    (s) => s.documentName === question.document && s.text.includes(question.span),
  );
  ranks.push({ kind: question.kind, rank: index === -1 ? null : index + 1 });
  await pause(SEARCH_GAP_MS);
}
const all: Ranks = ranks.map((r) => r.rank);
const ofKind = (kind: string): Ranks => ranks.filter((r) => r.kind === kind).map((r) => r.rank);

// ---- answers: half from each kind of question ----
const count = Number(values.answers);
const asked = [
  ...dataset.questions.filter((q) => q.kind === 'lexical').slice(0, Math.ceil(count / 2)),
  ...dataset.questions.filter((q) => q.kind === 'paraphrase').slice(0, Math.floor(count / 2)),
];
log(`Asking ${asked.length} questions of the answer model...`);
const acknowledged: number[] = [];
const ttft: number[] = [];
const total: number[] = [];
const costs: number[] = [];
let costUnknown = false;
let checked = 0;
let supported = 0;
let incomplete = 0;
let model = '';
for (const question of asked) {
  const { conversation } = await json<{ conversation: { id: string } }>(
    await call(`/workspaces/${ws}/conversations`, post({})),
  );
  const started = performance.now();
  const res = await call(
    `/workspaces/${ws}/conversations/${conversation.id}/messages`,
    post({ content: question.text }),
  );
  if (!res.ok || !res.body) throw new Error(`Asking answered ${res.status}`);
  for await (const frame of parseSse(res.body)) {
    // the server's first event is the acknowledgement that the question was saved
    if (frame.event === 'start') acknowledged.push(performance.now() - started);
    if (frame.event !== 'done') continue;
    const { message } = JSON.parse(frame.data) as {
      message: {
        status: string;
        content: string;
        model?: string;
        citations: Quoted[];
        costUsd: number | null;
        latency: { ttftMs: number | null; totalMs: number } | null;
      };
    };
    model ||= message.model ?? '';
    if (message.status !== 'complete') {
      incomplete++;
      continue;
    }
    if (message.latency?.ttftMs != null) ttft.push(message.latency.ttftMs);
    if (message.latency) total.push(message.latency.totalMs);
    if (message.costUsd === null) costUnknown = true;
    else costs.push(message.costUsd);
    const result = checkCitations(message.content, message.citations, (c) => (c as Quoted).quote);
    checked += result.checked;
    supported += result.supported;
  }
  await pause(ANSWER_GAP_MS);
}

// ---- report ----
const timing = (values: number[]) => ({
  p50: Math.round(percentile(values, 50)),
  p95: Math.round(percentile(values, 95)),
});
const report = {
  site: SITE,
  createdAt: new Date().toISOString(),
  datasetHash: hash,
  model,
  ingestSeconds,
  recallAt1: recallAt(all, 1),
  recallAt5: recallAt(all, 5),
  recallAt8: recallAt(all, 8),
  recallAt8ByKind: {
    lexical: recallAt(ofKind('lexical'), 8),
    paraphrase: recallAt(ofKind('paraphrase'), 8),
  },
  searchMs: timing(searchMs),
  answers: asked.length,
  incompleteAnswers: incomplete,
  acknowledgedMs: timing(acknowledged),
  ttftMs: timing(ttft),
  totalMs: timing(total),
  citationConsistency: checked === 0 ? null : supported / checked,
  citationsChecked: checked,
  costPerAnswerUsd:
    costUnknown || costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0) / costs.length,
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const ms = (t: { p50: number; p95: number }) => `p50 ${t.p50} ms, p95 ${t.p95} ms`;
console.log(
  [
    `site                    ${SITE}`,
    `answer model            ${model}`,
    `indexing 30 documents   ${ingestSeconds} s`,
    `recall@1 / @5 / @8      ${pct(report.recallAt1)} / ${pct(report.recallAt5)} / ${pct(report.recallAt8)}`,
    `  same words / para     ${pct(report.recallAt8ByKind.lexical)} / ${pct(report.recallAt8ByKind.paraphrase)}`,
    `search, from here       ${ms(report.searchMs)}`,
    `answers                 ${asked.length} asked, ${incomplete} not complete`,
    `acknowledged            ${ms(report.acknowledgedMs)}`,
    `first word (server)     ${ms(report.ttftMs)}`,
    `whole answer (server)   ${ms(report.totalMs)}`,
    `citation consistency    ${report.citationConsistency === null ? 'n/a' : pct(report.citationConsistency)} of ${checked} citations`,
    `cost per answer         ${report.costPerAnswerUsd === null ? 'unknown (no price set for this model)' : `$${report.costPerAnswerUsd.toFixed(5)}`}`,
  ].join('\n'),
);
const out = new URL('../results/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'remote.json'), `${JSON.stringify(report, null, 2)}\n`);
