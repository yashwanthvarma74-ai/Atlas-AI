import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EvalRun } from '@atlas/shared';
import { listEvalRuns } from './evalRuns';
import { parseId } from './ids';
import { createTestCore, type TestCore } from './test/context';
import { startTracing } from './trace';

let core: TestCore;
beforeAll(async () => {
  core = await createTestCore();
});
afterAll(() => core.destroy());

const run = (createdAt: string) => ({ createdAt, commit: 'abc1234' }) as unknown as EvalRun;

describe('evaluation runs', () => {
  it('lists the newest first and no more than asked for', async () => {
    await core.database.evalRuns.insertMany([
      { _id: new ObjectId(), ...run('2026-01-01T00:00:00.000Z') },
      { _id: new ObjectId(), ...run('2026-03-01T00:00:00.000Z') },
      { _id: new ObjectId(), ...run('2026-02-01T00:00:00.000Z') },
    ] as never);

    const runs = await listEvalRuns(core, 2);
    expect(runs.map((r) => r.createdAt)).toEqual([
      '2026-03-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    ]);
    expect(runs[0]?.id).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('parseId', () => {
  it('accepts a 24-character hex id and treats anything else as no id', () => {
    expect(parseId('6aea3425460cd46896ac6107')?.toHexString()).toBe('6aea3425460cd46896ac6107');
    for (const bad of ['', 'xyz', '6AEA3425460CD46896AC6107', 12, null, undefined, {}]) {
      expect(parseId(bad)).toBeNull();
    }
  });
});

describe('startTracing', () => {
  it('does nothing, and costs nothing, when there is no collector to send to', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const flush = await startTracing('test');
    await expect(flush()).resolves.toBeUndefined();
  });
});
