// Server-Sent Events, written by hand on purpose: the format is small, and the streaming code on both sides
// of the wire (the browser reading our answers, the API reading a model provider's) is then something that can
// be explained line by line.

export interface SseMessage {
  // "message" when the frame names none, as the specification says
  event: string;
  data: string;
}

// One frame as bytes-to-be: `event: name`, then one `data:` line per line of payload, then a blank line.
export function formatSse(event: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  // a newline inside data would end the line early, so each line gets its own data field
  const lines = payload.split(/\r\n|\r|\n/).map((line) => `data: ${line}`);
  return `event: ${event}\n${lines.join('\n')}\n\n`;
}

// Turns a response body into frames. Network chunks can end anywhere, in the middle of a word or between
// the two characters of a line break, so text is kept until a full line is there. A frame is complete at a
// blank line; a stream that ends in the middle of one drops it, as the specification requires.
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let event = 'message';
  let data: string[] = [];
  // "\r\n" split across two chunks must read as one line break, not two
  let skipLineFeed = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      let text = decoder.decode(value, { stream: true });
      if (skipLineFeed && text.startsWith('\n')) text = text.slice(1);
      skipLineFeed = false;

      pending += text;
      let start = 0;
      for (let i = 0; i < pending.length; i++) {
        const char = pending[i];
        if (char !== '\n' && char !== '\r') continue;
        if (char === '\r') {
          if (i + 1 < pending.length) {
            if (pending[i + 1] === '\n') i++;
          } else {
            skipLineFeed = true;
          }
        }
        const line = pending.slice(start, char === '\r' && pending[i] === '\n' ? i - 1 : i);
        start = i + 1;

        if (line === '') {
          if (data.length > 0) yield { event, data: data.join('\n') };
          event = 'message';
          data = [];
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          const raw = colon === -1 ? '' : line.slice(colon + 1);
          const value = raw.startsWith(' ') ? raw.slice(1) : raw;
          if (field === 'event') event = value;
          else if (field === 'data') data.push(value);
        }
      }
      pending = pending.slice(start);
    }
  } finally {
    reader.releaseLock();
  }
}

// One JSON value per line, as Ollama streams. Blank lines are skipped.
export async function* parseNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) yield JSON.parse(line);
    }
    if (pending.trim()) yield JSON.parse(pending);
  } finally {
    reader.releaseLock();
  }
}
