import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Worker } from 'tesseract.js';
import type { DocumentKind } from '@atlas/shared';
import type { Page } from './chunk';

// The file is the problem, not the system, so there is nothing to retry. The message is shown to the user.
export class ParseError extends Error {}

export interface ParseDeps {
  // reads the text out of an image; replaceable so tests do not download a language model
  ocr?: (image: Uint8Array) => Promise<string>;
  // parse in a child process started from this file, instead of in this one
  isolate?: { childPath: string };
}

const MAX_PDF_PAGES = 500;

export async function parseDocument(
  kind: DocumentKind,
  bytes: Uint8Array,
  deps: ParseDeps = {},
): Promise<Page[]> {
  switch (kind) {
    case 'pdf':
      return parsePdf(bytes);
    case 'text':
      return parseText(bytes);
    case 'image':
      return [{ page: 1, text: await (deps.ocr ?? recognise)(bytes) }];
  }
}

// A form feed separates pages in a plain text file, which is how text exported from a paged document
// usually arrives. Without one the whole file is page 1.
function parseText(bytes: Uint8Array): Page[] {
  const text = new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n');
  return text.split('\f').map((part, i) => ({ page: i + 1, text: part }));
}

async function parsePdf(bytes: Uint8Array): Promise<Page[]> {
  // pdf.js 6 releases a document through its loading task, not the document
  const task = getDocument({
    // pdf.js copies the buffer's ownership, so hand it a copy and keep ours
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch {
    await task.destroy().catch(() => undefined);
    throw new ParseError('This PDF could not be read. It may be damaged or password protected.');
  }

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new ParseError(`This PDF has ${pdf.numPages} pages. The limit is ${MAX_PDF_PAGES}.`);
    }
    const pages: Page[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('');
      pages.push({ page: number, text });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

// Words OCR is not sure of. On a clean scan nearly every word is above this; on a photo or a poster the rest is
// noise ("=] © ® °") that, left in, fills the index with junk.
const MIN_WORD_CONFIDENCE = 70;
// Below this overall, the picture is probably not a page of text, and a second pass for scattered text may do better.
const PAGE_CONFIDENCE = 75;

interface OcrBlock {
  paragraphs: { lines: { words: { text: string; confidence: number }[] }[] }[];
}

// The lines of recognised words that are sure enough and look like words, one line of the picture per line of text.
export function confidentLines(blocks: OcrBlock[], minConfidence = MIN_WORD_CONFIDENCE): string {
  const lines: string[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const words = line.words
          .filter((w) => w.confidence >= minConfidence && /[\p{L}\p{N}]{2,}/u.test(w.text))
          .map((w) => w.text);
        if (words.length > 0) lines.push(words.join(' '));
      }
    }
  }
  return lines.join('\n');
}

// One OCR engine for the life of the process. Loading it (the WebAssembly engine and a language model) takes longer
// than reading a picture on a small machine, so it is loaded on first use and kept.
//
// The container image carries Tesseract's "fast" English model in OCR_CACHE_DIR, which reads about a third faster
// than the default with the same confidence on our test images. Elsewhere the default is fetched once into a temp
// folder.
type OcrWorker = Worker;
let ocrWorker: Promise<OcrWorker> | undefined;

async function startOcr(): Promise<OcrWorker> {
  const { createWorker } = await import('tesseract.js');
  const baked = process.env.OCR_CACHE_DIR;
  if (baked && existsSync(join(baked, 'eng.traineddata'))) {
    return createWorker('eng', 1, { langPath: baked, gzip: false, cacheMethod: 'none' });
  }
  const cachePath = join(tmpdir(), 'atlas-tesseract');
  // tesseract.js only keeps the model in a folder that exists; without one it fetched it again for every picture
  await mkdir(cachePath, { recursive: true });
  return createWorker('eng', 1, { cachePath });
}

// A page of text is read as one. A picture that reads poorly that way (an infographic, a screenshot, a photo of a
// sign) is read again as scattered text, keeping only the words it is sure of, and whichever pass kept more is used.
async function recognise(image: Uint8Array): Promise<string> {
  const { PSM } = await import('tesseract.js');
  ocrWorker ??= startOcr();
  const worker = await ocrWorker;
  try {
    const buffer = Buffer.from(image);
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const page = await worker.recognize(buffer, {}, { blocks: true });
    if (page.data.confidence >= PAGE_CONFIDENCE) return page.data.text;

    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const scattered = await worker.recognize(buffer, {}, { blocks: true });
    const kept = confidentLines(scattered.data.blocks ?? []);
    const first = confidentLines(page.data.blocks ?? []);
    return kept.length >= first.length ? kept : first;
  } catch (error) {
    // an engine that failed is not trusted with the next picture
    ocrWorker = undefined;
    await worker.terminate().catch(() => undefined);
    throw error;
  }
}
