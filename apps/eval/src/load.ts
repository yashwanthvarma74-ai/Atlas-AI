import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSse } from '@atlas/shared';
import { DATA_DIR } from './dataset';
import { percentile } from '@atlas/core';

// A load test against a running stack: `docker compose --profile app up` with RATE_LIMIT_SCALE raised, then
//   BASE_URL=http://localhost:3002 npx tsx src/load.ts
// It signs in as a guest, uploads the benchmark corpus, then holds N requests in flight for a while against
// search and against chat, and reports throughput, p50/p95/p99 and the error rate. Chat reports the time to the
// first word as well as the whole answer.

const BASE = `${process.env.BASE_URL ?? 'http://localhost:3002'}/api`;
const SECONDS = Number(process.env.SECONDS ?? 10);
const LEVELS = (process.env.CONCURRENCY ?? '1,10,50').split(',').map(Number);

let cookie = '';
async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), cookie },
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  return res;
}

const json = async <T>(res: Response) => (await res.json()) as T;

const questions = [
  'how did revenue grow in Asia',
  'who owns the Payroll runbook',
  'recovery time objective of the Billing service',
  'notice period for the Contoso contract',
  'support tickets in Q3 2024',
];

async function setup() {
  await call('/auth/guest', { method: 'POST' });
  const { workspaces } = await json<{ workspaces: { id: string }[] }>(await call('/workspaces'));
  const workspace = workspaces[0]!.id;
  const files = readdirSync(join(DATA_DIR, 'corpus'));
  for (const name of files) {
    await call(`/workspaces/${workspace}/documents?name=${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: readFileSync(join(DATA_DIR, 'corpus', name)),
    });
  }
  // wait for the worker to index everything, and for search to catch up
  for (let i = 0; i < 120; i++) {
    const { documents: docs } = await json<{ documents: { status: string }[] }>(
      await call(`/workspaces/${workspace}/documents`),
    );
    if (
      docs.length === files.length &&
      docs.every((d) => d.status === 'indexed' || d.status === 'failed')
    )
      break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 5000));
  return workspace;
}

interface Sample {
  ms: number;
  ok: boolean;
  firstWordMs?: number;
}

async function hold(concurrency: number, once: (worker: number) => Promise<Sample>) {
  const samples: Sample[] = [];
  const end = Date.now() + SECONDS * 1000;
  await Promise.all(
    Array.from({ length: concurrency }, async (_, worker) => {
      while (Date.now() < end) samples.push(await once(worker));
    }),
  );
  return samples;
}

function row(name: string, concurrency: number, samples: Sample[]) {
  const ok = samples.filter((s) => s.ok);
  const ms = ok.map((s) => s.ms);
  const first = ok.flatMap((s) => (s.firstWordMs === undefined ? [] : [s.firstWordMs]));
  const f = (n: number) => n.toFixed(0);
  return [
    name,
    concurrency,
    (samples.length / SECONDS).toFixed(1),
    f(percentile(ms, 50)),
    f(percentile(ms, 95)),
    f(percentile(ms, 99)),
    first.length ? f(percentile(first, 95)) : '-',
    `${(((samples.length - ok.length) / Math.max(samples.length, 1)) * 100).toFixed(2)}%`,
  ].join(' | ');
}

const workspace = await setup();
const lines = [
  '| endpoint | in flight | req/s | p50 ms | p95 ms | p99 ms | first word p95 ms | errors |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
];

for (const level of LEVELS) {
  let n = 0;
  const search = await hold(level, async () => {
    const started = performance.now();
    const res = await call(`/workspaces/${workspace}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: questions[n++ % questions.length] }),
    });
    await res.arrayBuffer();
    return { ms: performance.now() - started, ok: res.ok };
  });
  lines.push(`| search | ${row('', level, search).replace(/^ \| /, '')} |`);
}

for (const level of LEVELS) {
  // one conversation per worker: a conversation takes one answer at a time
  const conversations = await Promise.all(
    Array.from(
      { length: level },
      async () =>
        (
          await json<{ conversation: { id: string } }>(
            await call(`/workspaces/${workspace}/conversations`, { method: 'POST' }),
          )
        ).conversation.id,
    ),
  );
  let n = 0;
  const chat = await hold(level, async (worker) => {
    const started = performance.now();
    const res = await call(
      `/workspaces/${workspace}/conversations/${conversations[worker]}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: questions[n++ % questions.length] }),
      },
    );
    let firstWordMs: number | undefined;
    let finished = false;
    if (res.ok && res.body) {
      for await (const frame of parseSse(res.body)) {
        if (frame.event === 'token' && firstWordMs === undefined)
          firstWordMs = performance.now() - started;
        if (frame.event === 'done') finished = JSON.parse(frame.data).message.status === 'complete';
      }
    }
    return { ms: performance.now() - started, ok: res.ok && finished, firstWordMs };
  });
  lines.push(`| chat | ${row('', level, chat).replace(/^ \| /, '')} |`);
}

console.log(lines.join('\n'));
