import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
