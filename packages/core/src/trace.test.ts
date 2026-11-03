import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toOtlp } from './otlp';
import { withSpan } from './trace';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => {
  trace.setGlobalTracerProvider(provider);
});
afterAll(() => provider.shutdown());

describe('withSpan', () => {
  it('nests a span started inside another and records the attributes it was given', async () => {
    exporter.reset();
    await withSpan('outer', { 'atlas.workspace_id': 'w1' }, () =>
      withSpan('inner', {}, async () => 'ok'),
    );

    const [inner, outer] = exporter.getFinishedSpans();
    expect(outer?.name).toBe('outer');
    expect(outer?.attributes['atlas.workspace_id']).toBe('w1');
    expect(inner?.name).toBe('inner');
  });

  it('records a failure on the span and rethrows it', async () => {
    exporter.reset();
    await expect(
      withSpan('broken', {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(2);
    expect(span?.events.some((event) => event.name === 'exception')).toBe(true);
  });
});

describe('toOtlp', () => {
  it('writes ids, nanosecond times, typed attributes, parents and failures the way a collector expects', async () => {
    exporter.reset();
    await withSpan(
      'parent',
      { 'atlas.count': 3, 'atlas.ratio': 0.5, 'atlas.ok': true, 'atlas.id': 'w1' },
      () =>
        withSpan('child', {}, async () => {
          throw new Error('boom');
        }),
    ).catch(() => {});

    const body = toOtlp(exporter.getFinishedSpans());
    const [scope] = body.resourceSpans[0]!.scopeSpans;
    const [child, parent] = scope!.spans;

    expect(parent!.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(parent!.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(parent!.startTimeUnixNano).toMatch(/^\d{19}$/);
    expect(parent!.attributes).toEqual(
      expect.arrayContaining([
        { key: 'atlas.count', value: { intValue: '3' } },
        { key: 'atlas.ratio', value: { doubleValue: 0.5 } },
        { key: 'atlas.ok', value: { boolValue: true } },
        { key: 'atlas.id', value: { stringValue: 'w1' } },
      ]),
    );
    expect(parent!.status.code).toBe(2);
    expect(child!.status).toEqual({ code: 2, message: 'boom' });
    expect(child!.events.map((event) => event.name)).toContain('exception');
  });
});
