import type { Attributes, AttributeValue } from '@opentelemetry/api';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

// Sends finished spans to an OpenTelemetry collector as OTLP over HTTP with a JSON body, using only fetch. The
// protocol is a few fields per span, and writing it here means one fewer package pinned to an exact version of the
// tracing API. The collector's address is the standard OTEL_EXPORTER_OTLP_ENDPOINT.

const toNanos = ([seconds, nanos]: [number, number]): string =>
  (BigInt(seconds) * 1_000_000_000n + BigInt(nanos)).toString();

function value(v: AttributeValue | undefined): Record<string, unknown> {
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number')
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v))
    return { arrayValue: { values: v.map((item) => value(item ?? undefined)) } };
  return { stringValue: String(v ?? '') };
}

const attributes = (attrs: Attributes) =>
  Object.entries(attrs).map(([key, v]) => ({ key, value: value(v) }));

export function toOtlp(spans: ReadableSpan[]) {
  return {
    resourceSpans: [
      {
        resource: { attributes: attributes(spans[0]?.resource.attributes ?? {}) },
        scopeSpans: [
          {
            scope: { name: spans[0]?.instrumentationScope.name ?? 'atlas' },
            spans: spans.map((span) => ({
              traceId: span.spanContext().traceId,
              spanId: span.spanContext().spanId,
              ...(span.parentSpanContext ? { parentSpanId: span.parentSpanContext.spanId } : {}),
              name: span.name,
              // OTLP numbers span kinds from 1 (internal); the API's enum starts at 0
              kind: span.kind + 1,
              startTimeUnixNano: toNanos(span.startTime),
              endTimeUnixNano: toNanos(span.endTime),
              attributes: attributes(span.attributes),
              events: span.events.map((event) => ({
                timeUnixNano: toNanos(event.time),
                name: event.name,
                attributes: attributes(event.attributes ?? {}),
              })),
              // the API's status codes (0 unset, 1 ok, 2 error) are the OTLP ones
              status: {
                code: span.status.code,
                ...(span.status.message ? { message: span.status.message } : {}),
              },
            })),
          },
        ],
      },
    ],
  };
}

export function createOtlpExporter(endpoint: string): SpanExporter {
  const url = `${endpoint.replace(/\/$/, '')}/v1/traces`;
  return {
    export(spans, done) {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toOtlp(spans)),
        signal: AbortSignal.timeout(10_000),
      }).then(
        // the callback takes the SDK's result codes: 0 succeeded, 1 failed
        (res) => done({ code: res.ok ? 0 : 1 }),
        () => done({ code: 1 }),
      );
    },
    shutdown: async () => {},
  };
}
