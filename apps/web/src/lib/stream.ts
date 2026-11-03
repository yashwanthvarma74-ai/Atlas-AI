import { parseSse, type ChatStreamEvent } from '@atlas/shared';
import { ApiError } from './api';

// Posts to a streaming endpoint and hands each event to `onEvent` as it arrives. The reader is the one in
// @atlas/shared, so what the server writes and what this reads are tested against each other.
//
// A refusal (not signed in, someone else's conversation, an answer already in progress) comes back as a
// normal error response before any stream starts, and is thrown as an ApiError. Once the first event has
// arrived every outcome, failures included, is an event, so this returns normally when the stream ends.
// Aborting through `signal` rejects with an AbortError, which is the caller's own doing.
export async function streamChat(
  path: string,
  body: unknown,
  { signal, onEvent }: { signal: AbortSignal; onEvent: (event: ChatStreamEvent) => void },
): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });

  if (!res.ok || !res.body) {
    const error = (await res.json().catch(() => null)) as {
      error?: { message?: string; code?: string };
    } | null;
    throw new ApiError(
      res.status,
      error?.error?.message ?? 'Something went wrong. Try again.',
      error?.error?.code,
    );
  }

  for await (const frame of parseSse(res.body)) {
    onEvent(JSON.parse(frame.data) as ChatStreamEvent);
  }
}
