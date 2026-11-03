# Service level objectives

What the service promises, how it is measured, and what would raise an alarm. No monitoring is deployed yet, so
"alerts" below say what should alert, not what does. The indicators are computed from data the app already keeps,
and the queries run as written.

| Objective                               | Target               | Indicator                                                                                |
| --------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| The API is up                           | 99.9%                | `GET /health` every minute from outside; counts as up only if it answers 200             |
| An answer is written (not failed)       | 99%                  | answers with status `complete` or `stopped` out of all answers                           |
| The first word arrives quickly          | p95 under 2 s        | `latency.ttftMs` of complete answers (with a real model; the offline one is much faster) |
| A document becomes searchable           | 95% within 2 minutes | time from upload to `indexed`                                                            |
| One workspace never sees another's data | 0 breaches           | the evaluation's cross-workspace count, in CI on every change                            |

99.9% a month is about 43 minutes of downtime. A `stopped` answer is the person's choice, so it is not a failure.

## Computing them

```bash
mongosh "$MONGODB_URI" --eval '
const since = new Date(Date.now() - 24 * 3600 * 1000);
printjson(db.messages.aggregate([
  { $match: { role: "assistant", createdAt: { $gte: since } } },
  { $group: { _id: "$status", n: { $sum: 1 } } },
]).toArray());
printjson(db.messages.aggregate([
  { $match: { role: "assistant", status: "complete", "latency.ttftMs": { $ne: null }, createdAt: { $gte: since } } },
  { $group: { _id: null, n: { $sum: 1 }, ttft: { $push: "$latency.ttftMs" } } },
  { $project: { n: 1, p95: { $arrayElemAt: [{ $sortArray: { input: "$ttft", sortBy: 1 } }, { $floor: { $multiply: [0.95, { $subtract: ["$n", 1] }] } }] } } },
]).toArray());'
```

Run against the load test's data it reported 11,127 answers, all `complete`, with a first-word p95 of 59 ms.

## What should alert

- `/health` failing for three checks in a row. It reports MongoDB as down with 503.
- Answers failing at more than 5% over ten minutes. The reasons are saved on each message (`error`), so the alert says
  whether it is the provider, the search or a timeout.
- A document in `queued` for over five minutes: the worker is down or Redis lost the queue. The worker's sweep
  re-queues after two minutes, so staying queued means the worker is not running.
- Any failed evaluation gate on `main`.

## What is not covered

Error budgets, paging and dashboards. There is structured JSON logging (Pino) on every request and no trace
collector, no metrics endpoint and no Grafana dashboard yet. Those are the next step, and this document is
what they would be built to report.
