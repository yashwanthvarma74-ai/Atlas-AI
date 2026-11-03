import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_DIR, loadDataset } from './dataset';
import { build } from './generate';

const { corpus, dataset } = build();
const textOf = (name: string) => corpus.find((file) => file.name === name)!.text;

describe('the benchmark', () => {
  it('is the same every time it is built, and the same as the files in the repository', () => {
    expect(build()).toEqual({ corpus, dataset });
    // if this fails, run `npm run generate -w @atlas/eval` and commit the result
    expect(JSON.parse(readFileSync(join(DATA_DIR, 'dataset.json'), 'utf8'))).toEqual(dataset);
    for (const file of corpus)
      expect(readFileSync(join(DATA_DIR, 'corpus', file.name), 'utf8')).toBe(file.text);
  });

  it('has the size the spec asks for: 200 or more questions, over a corpus of many documents', () => {
    expect(dataset.questions.length).toBeGreaterThanOrEqual(200);
    expect(corpus).toHaveLength(30);
    const kinds = (kind: string) => dataset.questions.filter((q) => q.kind === kind).length;
    expect(kinds('lexical')).toBe(120);
    expect(kinds('paraphrase')).toBe(120);
  });

  it('gives every document three full pages', () => {
    for (const file of corpus) {
      const pages = file.text.split('\f');
      expect(pages).toHaveLength(3);
      for (const page of pages) expect(page.trim().length).toBeGreaterThan(500);
    }
  });

  it('labels every answerable question with a sentence that is in its document exactly once', () => {
    for (const question of dataset.questions) {
      expect(question.document, question.id).toBeTruthy();
      const text = textOf(question.document);
      const occurrences = text.split(question.span).length - 1;
      expect(occurrences, `${question.id}: ${question.span}`).toBe(1);
    }
  });

  it('never repeats a sentence anywhere in the corpus, so each label points at one place', () => {
    const sentences = corpus
      .flatMap((file) => file.text.match(/[^.]+\./g) ?? [])
      .map((s) => s.trim());
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('has unique question ids and unique question texts', () => {
    expect(new Set(dataset.questions.map((q) => q.id)).size).toBe(dataset.questions.length);
    expect(new Set(dataset.questions.map((q) => q.text)).size).toBe(dataset.questions.length);
  });

  it('keeps the paraphrased questions free of the words that are only in the answer sentence', () => {
    // a paraphrase that reused the sentence's distinguishing words would not test meaning at all
    const lexicalOnly = [
      'reduce',
      'increase',
      'recovery time objective',
      'keep its backups',
      'owns',
      'renew',
      'notice period',
    ];
    const offenders = dataset.questions
      .filter((q) => q.kind === 'paraphrase')
      .filter((q) => lexicalOnly.some((phrase) => q.text.toLowerCase().includes(phrase)));
    expect(offenders.map((q) => q.text)).toEqual([]);
  });

  it('loads the same dataset from disk, with a stable hash', () => {
    const loaded = loadDataset();
    expect(loaded.dataset).toEqual(dataset);
    expect(loaded.corpus).toHaveLength(30);
    expect(loaded.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(loadDataset().hash).toBe(loaded.hash);
  });
});
