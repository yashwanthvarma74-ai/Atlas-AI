import { fork } from 'node:child_process';
import type { DocumentKind } from '@atlas/shared';
import type { Page } from './chunk';
import { ParseError, parseDocument } from './parse';

// An uploaded file is untrusted bytes handed to a PDF parser and an OCR engine. Parsing it in a child process means
// a crafted file that crashes, hangs or eats memory costs that child and not the worker, and the child starts with
// none of the worker's environment: no database credentials, no storage keys, no model keys.

const MAX_OLD_SPACE_MB = 384;

type Request = { kind: DocumentKind; bytes: Uint8Array };
type Reply = { pages: Page[] } | { error: string; parse: boolean };

// Runs in the child. Reads one request, answers it and exits.
export function runParseChild(): void {
  process.once('message', async (request: Request) => {
    let reply: Reply;
    try {
      reply = { pages: await parseDocument(request.kind, request.bytes) };
    } catch (error) {
      reply = { error: (error as Error).message, parse: error instanceof ParseError };
    }
    process.send!(reply, () => process.exit(0));
  });
}

// Parses in a fresh child process and kills it if it takes longer than `timeoutMs`.
export function parseInChild(
  childPath: string,
  kind: DocumentKind,
  bytes: Uint8Array,
  timeoutMs: number,
): Promise<Page[]> {
  return new Promise((resolve, reject) => {
    const child = fork(childPath, [], {
      // nothing from the parent's environment but what a Node process needs to find its files
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? '',
      },
      execArgv: [`--max-old-space-size=${MAX_OLD_SPACE_MB}`],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let settled = false;
    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      done();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`Parsing did not finish within ${timeoutMs} ms.`))),
      timeoutMs,
    );
    child.once('message', (reply: Reply) =>
      finish(() =>
        'pages' in reply
          ? resolve(reply.pages)
          : reject(reply.parse ? new ParseError(reply.error) : new Error(reply.error)),
      ),
    );
    // a crash, an out-of-memory kill or a start that failed all end here, with no reply
    child.once('exit', (code, signal) =>
      finish(() =>
        reject(new Error(`The parser stopped without an answer (${signal ?? `exit ${code}`}).`)),
      ),
    );
    child.once('error', (error) => finish(() => reject(error)));
    child.send({ kind, bytes } satisfies Request);
  });
}
