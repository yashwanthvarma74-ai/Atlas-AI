// A question asked from the workspace page travels to the conversation it opens through session storage, not the
// address: an address ends up in history, logs and the referrer, and a question can say anything.
const key = (conversationId: string) => `atlas:ask:${conversationId}`;

export function stashQuestion(conversationId: string, question: string) {
  try {
    sessionStorage.setItem(key(conversationId), question);
  } catch {
    // storage refused (a private window); the conversation opens empty and the question can be typed again
  }
}

// Returns the waiting question once, and forgets it, so a reload does not ask it twice.
export function takeQuestion(conversationId: string): string | null {
  try {
    const question = sessionStorage.getItem(key(conversationId));
    sessionStorage.removeItem(key(conversationId));
    return question;
  } catch {
    return null;
  }
}
