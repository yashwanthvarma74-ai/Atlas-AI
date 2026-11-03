import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type QuestionKind = 'lexical' | 'paraphrase';

export interface Question {
  id: string;
  text: string;
  kind: QuestionKind;
  // where the answer is: a document, and the exact sentence in it. Labels name text, not chunks, so the same
  // dataset stays valid whatever the chunk size is.
  document: string;
  span: string;
}

export interface Dataset {
  version: number;
  seed: number;
  questions: Question[];
}

export interface CorpusFile {
  name: string;
  text: string;
}

export const DATA_DIR = new URL('../data/', import.meta.url).pathname;

export function loadDataset(dir = DATA_DIR): {
  dataset: Dataset;
  corpus: CorpusFile[];
  hash: string;
} {
  const dataset = JSON.parse(readFileSync(join(dir, 'dataset.json'), 'utf8')) as Dataset;
  const corpus = readdirSync(join(dir, 'corpus'))
    .filter((name) => name.endsWith('.txt'))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, 'corpus', name), 'utf8') }));

  // identifies exactly what a run was scored on, so numbers from different datasets are never compared
  const hash = createHash('sha256')
    .update(JSON.stringify(dataset))
    .update(corpus.map((file) => `${file.name}\n${file.text}`).join('\n'))
    .digest('hex')
    .slice(0, 12);
  return { dataset, corpus, hash };
}
