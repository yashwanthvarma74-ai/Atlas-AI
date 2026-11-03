// Load test for the API: search, then chat, at 1, 10 and 50 requests in flight.
//
//   docker run --rm -i -v "$PWD:/work" -w /work/infra/k6 -e BASE_URL=http://host.docker.internal:4002 grafana/k6 run atlas.js
//
// The API must run with RATE_LIMIT_SCALE raised (1000 is plenty), or the limiter is what gets measured. Each virtual
// user holds one request in flight at a time. Chat reports the first word as the server saw it, taken from the
// finished message, since k6 reads the stream as a whole.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:4002';
const ORIGIN = __ENV.SITE_ORIGIN || 'http://localhost:3002';
const SECONDS = Number(__ENV.SECONDS || 10);

const DOCUMENTS = Array.from(
  { length: 30 },
  (_, i) => `ops-notes-${String(i + 1).padStart(2, '0')}.txt`,
);
// open() runs once, in the init stage, and reads the benchmark corpus the evaluation uses
const corpus = DOCUMENTS.map((name) => ({
  name,
  bytes: open(`../../apps/eval/data/corpus/${name}`, 'b'),
}));

const QUESTIONS = [
  'how did revenue grow in Asia',
  'who owns the Payroll runbook',
  'recovery time objective of the Billing service',
  'notice period for the Contoso contract',
  'support tickets in Q3 2024',
];

const firstWord = new Trend('chat_first_word_ms', true);

const level = (name, exec, startTime, vus) => ({
  executor: 'constant-vus',
  exec,
  vus,
  duration: `${SECONDS}s`,
  startTime,
  tags: { endpoint: name, in_flight: String(vus) },
});

const scenarios = {};
const levels = [1, 10, 50];
let offset = 0;
for (const exec of ['search', 'chat']) {
  for (const vus of levels) {
    scenarios[`${exec}_${vus}`] = level(exec, exec, `${offset}s`, vus);
    offset += SECONDS + 2;
  }
}

// Naming a threshold for each endpoint and level is what makes k6 print p50, p95 and p99 for each of them.
const perLevel = {};
for (const exec of ['search', 'chat']) {
  for (const vus of levels) {
    perLevel[`http_req_duration{endpoint:${exec},in_flight:${vus}}`] = [
      exec === 'search' ? 'p(95)<500' : 'p(95)<2000',
    ];
  }
}

export const options = {
  scenarios,
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    // the targets this test is held to; a run that misses one exits non-zero
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    ...perLevel,
  },
};

function post(path, body, params = {}) {
  return http.post(`${BASE}${path}`, body, {
    ...params,
    headers: { Origin: ORIGIN, ...(params.headers || {}) },
  });
}

export function setup() {
  post('/auth/guest', null);
  const workspace = http.get(`${BASE}/workspaces`).json('workspaces.0.id');
  for (const file of corpus) {
    post(`/workspaces/${workspace}/documents?name=${file.name}`, file.bytes, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }
  // wait for the worker to index everything, then for the search indexes to catch up
  for (let i = 0; i < 120; i++) {
    const docs = http.get(`${BASE}/workspaces/${workspace}/documents`).json('documents');
    if (
      docs.length === DOCUMENTS.length &&
      docs.every((d) => d.status === 'indexed' || d.status === 'failed')
    )
      break;
    sleep(1);
  }
  sleep(5);
  // the cookie jar belongs to this VU; hand the session to the others
  const cookie = http.cookieJar(BASE).cookiesForURL(BASE).atlas_session[0];
  return { workspace, cookie };
}

function session(data) {
  http.cookieJar().set(BASE, 'atlas_session', data.cookie);
}

export function search(data) {
  session(data);
  const res = post(
    `/workspaces/${data.workspace}/search`,
    JSON.stringify({ query: QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)] }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'search ok': (r) => r.status === 200 });
}

export function chat(data) {
  session(data);
  const json = { headers: { 'Content-Type': 'application/json' } };
  // one conversation per iteration: a conversation takes one answer at a time
  const created = post(`/workspaces/${data.workspace}/conversations`, '{}', json);
  const id = created.json('conversation.id');
  const res = post(
    `/workspaces/${data.workspace}/conversations/${id}/messages`,
    JSON.stringify({ content: QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)] }),
    json,
  );
  const done = /event: done\ndata: (.*)\n/.exec(res.body);
  const message = done ? JSON.parse(done[1]).message : null;
  if (message && message.latency && message.latency.ttftMs !== null)
    firstWord.add(message.latency.ttftMs);
  check(res, { 'chat complete': () => message !== null && message.status === 'complete' });
}
