export interface Page {
  page: number;
  text: string;
}

export interface ChunkOptions {
  // in tokens, estimated at four characters each
  targetTokens: number;
  overlapTokens: number;
}

export interface Chunk {
  // 1-based page the chunk came from; a chunk never spans two pages, so a citation names one page
  page: number;
  // position within the document, in reading order
  ord: number;
  text: string;
  tokenCount: number;
}

const CHARS_PER_TOKEN = 4;

export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

// A blank line ends a paragraph, and so does the line before a Markdown heading, so a heading starts
// a new unit instead of trailing the one above it.
const PARAGRAPH_BREAK = /\n\s*\n|\n(?=#{1,6}\s)/;
const SENTENCE_BREAK = /(?<=[.!?])\s+/;

// Splits one page into pieces that each fit in `limit` characters, preferring the largest natural
// boundary that works: paragraph, then sentence, then word.
function toUnits(text: string, limit: number): string[] {
  return text
    .split(PARAGRAPH_BREAK)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) =>
      paragraph.length <= limit ? [paragraph] : splitLong(paragraph, limit),
    );
}

function splitLong(paragraph: string, limit: number): string[] {
  const units: string[] = [];
  for (const sentence of paragraph.split(SENTENCE_BREAK)) {
    if (sentence.length <= limit) {
      units.push(sentence);
      continue;
    }
    // no sentence boundary to use: cut at words, and at characters only inside a single huge "word"
    let line = '';
    for (const word of sentence.split(/\s+/)) {
      if (line && line.length + 1 + word.length > limit) {
        units.push(line);
        line = '';
      }
      let rest = word;
      while (rest.length > limit) {
        units.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      line = line ? `${line} ${rest}` : rest;
    }
    if (line) units.push(line);
  }
  return units;
}

const joinUnits = (units: string[]) => units.join('\n\n');

// The trailing units of a finished chunk that fit in `max` characters, to start the next one with.
function overlapTail(units: string[], max: number): string[] {
  const tail: string[] = [];
  for (let i = units.length - 1; i >= 0; i--) {
    if (joinUnits([units[i]!, ...tail]).length > max) break;
    tail.unshift(units[i]!);
  }
  return tail;
}

// Packs the units of one page into chunks of at most `targetTokens`. Each chunk after the first begins
// with the last few units of the one before it (up to `overlapTokens`), so a sentence that straddles a
// boundary is whole in at least one chunk.
export function chunkText(text: string, options: ChunkOptions): string[] {
  const limit = options.targetTokens * CHARS_PER_TOKEN;
  // overlap may never take more than half a chunk, or the window would barely move
  const overlapLimit = Math.min(options.overlapTokens * CHARS_PER_TOKEN, Math.floor(limit / 2));

  const chunks: string[] = [];
  let current: string[] = [];
  // how many leading units of `current` repeat the previous chunk rather than being new
  let carried = 0;

  for (const unit of toUnits(text, limit)) {
    if (current.length > carried && joinUnits([...current, unit]).length > limit) {
      chunks.push(joinUnits(current));
      current = overlapTail(current, overlapLimit);
      carried = current.length;
    }
    // a carried tail plus this unit can still overflow; drop the tail rather than split the unit
    if (joinUnits([...current, unit]).length > limit) {
      current = [];
      carried = 0;
    }
    current.push(unit);
  }
  if (current.length > carried) chunks.push(joinUnits(current));
  return chunks;
}

export function chunkPages(pages: Page[], options: ChunkOptions): Chunk[] {
  const chunks: Chunk[] = [];
  for (const { page, text } of pages) {
    for (const piece of chunkText(text, options)) {
      chunks.push({ page, ord: chunks.length, text: piece, tokenCount: estimateTokens(piece) });
    }
  }
  return chunks;
}
