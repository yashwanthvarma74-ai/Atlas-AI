import { describe, expect, it } from 'vitest';
import { extractToolCalls, stripToolCalls } from './tools';

const call = '<tool_call>{"tool":"save_note","args":{"title":"T","text":"Body"}}</tool_call>';

describe('extractToolCalls', () => {
  it('returns the calls in order, and the answer without them', () => {
    const result = extractToolCalls(`Here is the summary.\n\n${call}\n\nAnything else?`);
    expect(result.calls).toEqual([
      { raw: '{"tool":"save_note","args":{"title":"T","text":"Body"}}' },
    ]);
    expect(result.text).toBe('Here is the summary.\n\nAnything else?');
  });

  it('finds several calls', () => {
    expect(extractToolCalls(`${call} and ${call}`).calls).toHaveLength(2);
  });

  it('hands over what is written without judging it: a bad block is for the server to refuse', () => {
    expect(extractToolCalls('<tool_call>not json</tool_call>').calls).toEqual([
      { raw: 'not json' },
    ]);
  });

  it('finds nothing in an answer with no blocks', () => {
    expect(extractToolCalls('Just an answer.')).toEqual({ text: 'Just an answer.', calls: [] });
  });

  it('does not act on a block that was never closed, such as one cut off when the answer was stopped', () => {
    const result = extractToolCalls('Saving it now. <tool_call>{"tool":"save_note","args":{"ti');
    expect(result.calls).toEqual([]);
    expect(result.text).toBe('Saving it now.');
  });

  it('does not treat the opening tag alone, or a look-alike, as a call', () => {
    expect(extractToolCalls('<tool_call>').calls).toEqual([]);
    expect(
      extractToolCalls('<tool-call>{}</tool-call> and <TOOL_CALL>{}</TOOL_CALL>').calls,
    ).toEqual([]);
  });
});

describe('stripToolCalls', () => {
  it('leaves text with no tool call exactly as written, whitespace and all', () => {
    const text = '  Code:\n\n\n\n    indented\n ';
    expect(stripToolCalls(text)).toBe(text);
    expect(extractToolCalls(text)).toEqual({ text, calls: [] });
  });

  it('hides a block while it is still arriving', () => {
    expect(stripToolCalls('Saving it. <tool_call>{"tool":"sa')).toBe('Saving it.');
  });

  it('leaves no run of blank lines where a block was', () => {
    expect(stripToolCalls(`One.\n\n${call}\n\n\n\nTwo.`)).toBe('One.\n\nTwo.');
  });
});
