import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';

// Spans carry ids, counts and timings, never a question, a passage or an answer: a trace backend is another
// place data can leak from, so nothing a person wrote goes into one.
const tracer = trace.getTracer('atlas');

// Runs `work` inside a span that is the parent of any span started during it. A throw is recorded on the span
// and goes on to the caller.
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await work(span);
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}

// For work whose end is not the end of a function, such as a stream that is read in a loop. The caller ends it.
export const startSpan = (name: string, attributes: Attributes = {}): Span =>
  tracer.startSpan(name, { attributes });

// Starts exporting spans when OTEL_EXPORTER_OTLP_ENDPOINT is set, and does nothing otherwise, so a machine with
// no collector pays nothing. Returns a function that flushes what is waiting.
export async function startTracing(serviceName: string): Promise<() => Promise<void>> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return async () => {};
  const [
    { NodeTracerProvider },
    { BatchSpanProcessor },
    { OTLPTraceExporter },
    { resourceFromAttributes },
  ] = await Promise.all([
    import('@opentelemetry/sdk-trace-node'),
    import('@opentelemetry/sdk-trace-base'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
  ]);
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register();
  return () => provider.shutdown();
}
