import { describe, expect, it } from 'vitest';
import { confidentLines, ParseError, parseDocument } from './parse';
import { makePdf } from './test/pdf';

const enc = (text: string) => new TextEncoder().encode(text);

describe('confidentLines', () => {
  const word = (text: string, confidence: number) => ({ text, confidence });
  const block = (...lines: ReturnType<typeof word>[][]) => ({
    paragraphs: [{ lines: lines.map((words) => ({ words })) }],
  });

  it('keeps the words it is sure of, one line of the picture per line of text', () => {
    const text = confidentLines([
      block([word('FRONTEND', 96), word('BACKEND', 91)], [word('Basics', 88)]),
    ]);
    expect(text).toBe('FRONTEND BACKEND\nBasics');
  });

  it('drops doubtful words and stray symbols, and a line that is left empty', () => {
    const text = confidentLines([
      block(
        [word('Postgres', 93), word('=]', 80), word('©', 90), word('Nodes', 40)],
        [word('®', 95)],
      ),
    ]);
    expect(text).toBe('Postgres');
  });
});

describe('parseDocument: PDF', () => {
  it('reads the text of each page and keeps the page numbers', async () => {
    const pdf = makePdf([['Revenue grew in the third quarter.'], ['Costs fell by six percent.']]);
    const pages = await parseDocument('pdf', pdf);

    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(pages[0]?.text).toContain('Revenue grew in the third quarter.');
    expect(pages[1]?.text).toContain('Costs fell by six percent.');
    expect(pages[0]?.text).not.toContain('Costs');
  });

  it('joins lines that wrap into one paragraph, and keeps paragraphs apart', async () => {
    const [page] = await parseDocument(
      'pdf',
      makePdf([['The new tracking page', 'resolves most questions.', '', 'Support tickets fell.']]),
    );
    expect(page?.text).toBe(
      'The new tracking page resolves most questions.\n\nSupport tickets fell.',
    );
  });

  it('handles text with parentheses and backslashes', async () => {
    const [page] = await parseDocument('pdf', makePdf([['Profit (adjusted) \\ total']]));
    expect(page?.text).toContain('Profit (adjusted) \\ total');
  });

  it('reports a damaged file in words a user can act on', async () => {
    const error = await parseDocument('pdf', enc('%PDF-1.4 this is not really a pdf')).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ParseError);
    expect(error.message).toMatch(/could not be read/);
  });

  it('does not change the bytes it was given', async () => {
    const pdf = makePdf([['Immutable']]);
    const before = Buffer.from(pdf).toString('hex');
    await parseDocument('pdf', pdf);
    expect(Buffer.from(pdf).toString('hex')).toBe(before);
  });
});

describe('parseDocument: text', () => {
  it('returns one page for a plain file and normalises line endings', async () => {
    const pages = await parseDocument('text', enc('Line one\r\nLine two\r\n'));
    expect(pages).toEqual([{ page: 1, text: 'Line one\nLine two\n' }]);
  });

  it('starts a new page at each form feed', async () => {
    const pages = await parseDocument('text', enc('Page one\fPage two\fPage three'));
    expect(pages.map((p) => p.text)).toEqual(['Page one', 'Page two', 'Page three']);
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
  });
});

describe('parseDocument: image', () => {
  it('returns what the OCR step read as page 1', async () => {
    const pages = await parseDocument('image', new Uint8Array([1, 2, 3]), {
      ocr: async () => 'Text found in the picture',
    });
    expect(pages).toEqual([{ page: 1, text: 'Text found in the picture' }]);
  });
});
