import { fork, type ChildProcess } from 'node:child_process';
import { setPriority } from 'node:os';
import type { DocumentKind } from '@atlas/shared';
import type { Page } from './chunk';
import { ParseError, parseDocument } from './parse';

// An uploaded file is untrusted bytes handed to a PDF parser and an OCR engine. Parsing it in a child process means
// a crafted file that crashes, hangs or eats memory costs that child and not the worker, and the child starts with
// none of the worker's environment: no database credentials, no storage keys, no model keys.
//
// The child is started once and kept for the files that follow. Starting a Node process and loading the parsers
// costs about half a minute on a 0.1 CPU machine, which was most of the time a small file took to index. A child that
// crashes, runs out of memory or overruns its time is killed, and the next file gets a new one.

const MAX_OLD_SPACE_MB = 384;
// the lowest scheduling priority there is
const CHILD_PRIORITY = 19;

type Request = { id: number; kind: DocumentKind; bytes: Uint8Array };
type Reply = { id: number } & ({ pages: Page[] } | { error: string; parse: boolean });

// Runs in the child: answers each request in turn, for as long as the parent keeps it.
export function runParseChild(): void {
  process.on('message', async (request: Request) => {
    let reply: Reply;
    try {
      reply = { id: request.id, pages: await parseDocument(request.kind, request.bytes) };
    } catch (error) {
      reply = {
        id: request.id,
        error: (error as Error).message,
        parse: error instanceof ParseError,
      };
    }
    process.send!(reply);
  });
}

interface Waiting {
  resolve(pages: Page[]): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  // the process the request went to, so one child ending fails only its own work
  owner: ChildProcess;
}

let child: ChildProcess | undefined;
let childPathInUse: string | undefined;
let nextId = 1;
const waiting = new Map<number, Waiting>();

function settle(id: number, done: (w: Waiting) => void) {
  const w = waiting.get(id);
  if (!w) return;
  waiting.delete(id);
  clearTimeout(w.timer);
  done(w);
  // an idle child must not keep the process alive on its own
  if (waiting.size === 0) child?.channel?.unref();
}

function start(childPath: string): ChildProcess {
  const started = fork(childPath, [], {
    env: {
      // nothing from the parent's environment but what a Node process needs to find its files
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      TMPDIR: process.env.TMPDIR ?? '',
      // where the OCR language model is: a path, not a secret
      ...(process.env.OCR_CACHE_DIR ? { OCR_CACHE_DIR: process.env.OCR_CACHE_DIR } : {}),
    },
    execArgv: [`--max-old-space-size=${MAX_OLD_SPACE_MB}`],
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  started.on('message', (reply: Reply) =>
    settle(reply.id, (w) =>
      'pages' in reply
        ? w.resolve(reply.pages)
        : w.reject(reply.parse ? new ParseError(reply.error) : new Error(reply.error)),
    ),
  );
  // a crash, an out-of-memory kill or a start that failed: everything it was working on fails, and it is replaced
  const gone = (why: string) => {
    if (child === started) child = undefined;
    for (const [id, w] of [...waiting]) {
      if (w.owner === started) {
        settle(id, (gone) =>
          gone.reject(new Error(`The parser stopped without an answer (${why}).`)),
        );
      }
    }
  };
  started.once('exit', (code, signal) => gone(signal ?? `exit ${code}`));
  started.once('error', (error) => gone(error.message));
  // Parsing is the heavy work and answering requests is the urgent work. On a machine with a tenth of a CPU the child
  // would otherwise take the whole share and the API would stop answering, health checks included.
  if (started.pid) {
    try {
      setPriority(started.pid, CHILD_PRIORITY);
    } catch {
      // not allowed here; it runs at the same priority, which is slower to answer but still correct
    }
  }
  started.unref();
  return started;
}

// Parses in the kept child process, starting one if there is none, and kills it if this file takes longer than
// `timeoutMs`.
export function parseInChild(
  childPath: string,
  kind: DocumentKind,
  bytes: Uint8Array,
  timeoutMs: number,
): Promise<Page[]> {
  if (!child || childPathInUse !== childPath) {
    child?.kill();
    child = start(childPath);
    childPathInUse = childPath;
  }
  const current = child;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      settle(id, (w) => w.reject(new Error(`Parsing did not finish within ${timeoutMs} ms.`)));
      current.kill('SIGKILL');
    }, timeoutMs);
    waiting.set(id, { resolve, reject, timer, owner: current });
    current.channel?.ref();
    current.send({ id, kind, bytes } satisfies Request);
  });
}

// Ends the kept child, for a clean shutdown.
export function stopParseChild(): void {
  child?.kill();
  child = undefined;
}
