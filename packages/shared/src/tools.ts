// How a model asks to use a tool. It writes a tagged block in its answer:
//
//   <tool_call>{"tool": "save_note", "args": {"title": "...", "text": "..."}}</tool_call>
//
// This is plain text on purpose. It works the same with every model provider, and it is only ever read from
// what the model itself wrote. Nothing in the block does anything by being there: it is a request, and a person
// has to approve it.

export const MAX_TOOL_CALLS_PER_ANSWER = 3;

const BLOCK = /<tool_call>([\s\S]*?)<\/tool_call>/g;
// a block the answer ended in the middle of, because it was stopped or cut off
const UNFINISHED = /<tool_call>[\s\S]*$/;

export interface ProposedCall {
  // what was written between the tags, before anything has checked it
  raw: string;
}

// Removes every tool call block from an answer, so the person reads the words and not the markup. Also used
// while an answer streams, when the closing tag has not arrived yet.
export function stripToolCalls(text: string): string {
  // an answer with no tool call in it is left exactly as it was written, down to its whitespace
  if (!text.includes('<tool_call>')) return text;
  return text
    .replace(BLOCK, '')
    .replace(UNFINISHED, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The calls an answer asks for, in order, and the answer without them. Only complete blocks count.
export function extractToolCalls(text: string): { text: string; calls: ProposedCall[] } {
  const calls = [...text.matchAll(BLOCK)].map((match) => ({ raw: match[1]!.trim() }));
  return { text: stripToolCalls(text), calls };
}
