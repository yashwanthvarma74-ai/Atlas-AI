import { z } from 'zod';
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  DOCUMENT_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  QUESTION_MAX_LENGTH,
  SEARCH_MAX_DOCUMENTS,
  WORKSPACE_NAME_MAX_LENGTH,
} from './limits';

// ---- people ----

// Emails are compared in lower case everywhere, so the schema does the folding once, at the door.
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH)
  .pipe(z.email('Enter a valid email address.'));

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(NAME_MAX_LENGTH, `Use at most ${NAME_MAX_LENGTH} characters.`);

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

export const registerInputSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

// A login only checks that the password is present. The length rules belong to choosing one, and
// repeating them here would tell an attacker which guesses are not worth trying.
export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  guest: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

// ---- workspaces ----

// viewer: read and ask. editor: also add and remove documents. owner: also manage the members.
export const roleSchema = z.enum(['viewer', 'editor', 'owner']);
export type Role = z.infer<typeof roleSchema>;

// Exactly one owner exists per workspace and nobody is promoted to it, so it cannot be handed out.
export const memberRoleSchema = z.enum(['viewer', 'editor']);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const createWorkspaceInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter a name.')
    .max(WORKSPACE_NAME_MAX_LENGTH, `Use at most ${WORKSPACE_NAME_MAX_LENGTH} characters.`),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  // the signed-in user's role in it
  role: roleSchema,
  createdAt: z.string(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const addMemberInputSchema = z.object({
  email: emailSchema,
  role: memberRoleSchema,
});
export type AddMemberInput = z.infer<typeof addMemberInputSchema>;

export const updateMemberInputSchema = z.object({ role: memberRoleSchema });
export type UpdateMemberInput = z.infer<typeof updateMemberInputSchema>;

export const memberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  role: roleSchema,
  joinedAt: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

// ---- errors ----

// The body of every non-2xx response from the API.
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// ---- documents ----

// What a file is, decided from its bytes. The browser's Content-Type is never trusted.
export const documentKindSchema = z.enum(['pdf', 'text', 'image']);
export type DocumentKind = z.infer<typeof documentKindSchema>;

// queued, parsing and embedding are in progress; indexed and failed are final until a retry.
export const documentStatusSchema = z.enum(['queued', 'parsing', 'embedding', 'indexed', 'failed']);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const IN_PROGRESS_STATUSES: DocumentStatus[] = ['queued', 'parsing', 'embedding'];

export const documentSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: documentKindSchema,
  size: z.number(),
  status: documentStatusSchema,
  // why it failed, in words a user can act on; only set when status is "failed"
  error: z.string().nullable(),
  pageCount: z.number().nullable(),
  chunkCount: z.number().nullable(),
  uploadedBy: z.string(),
  createdAt: z.string(),
});
export type DocumentSummary = z.infer<typeof documentSchema>;

export const uploadQuerySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name the file.')
    .max(DOCUMENT_NAME_MAX_LENGTH, `Use at most ${DOCUMENT_NAME_MAX_LENGTH} characters.`),
});

// ---- search ----

export const searchInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'Ask a question or type some words.')
    .max(QUESTION_MAX_LENGTH, `Use at most ${QUESTION_MAX_LENGTH} characters.`),
  // narrow the search to these documents; leave out to search the whole workspace
  documentIds: z.array(z.string()).max(SEARCH_MAX_DOCUMENTS).optional(),
});
export type SearchInput = z.infer<typeof searchInputSchema>;

// A passage that matched, numbered S1, S2, ... in rank order. The same numbers are what an answer cites.
export const sourceSchema = z.object({
  n: z.number(),
  chunkId: z.string(),
  documentId: z.string(),
  documentName: z.string(),
  page: z.number(),
  text: z.string(),
  score: z.number(),
});
export type SearchSource = z.infer<typeof sourceSchema>;

export const passageSchema = z.object({
  id: z.string(),
  ord: z.number(),
  page: z.number(),
  text: z.string(),
});
export type Passage = z.infer<typeof passageSchema>;

// ---- chat ----

export const conversationVisibilitySchema = z.enum(['private', 'workspace']);
export type ConversationVisibility = z.infer<typeof conversationVisibilitySchema>;

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  // private: only its author reads it. workspace: every member can read it; only the author can add to it.
  visibility: conversationVisibilitySchema,
  authorId: z.string(),
  authorName: z.string(),
  mine: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const updateConversationInputSchema = z
  .object({
    title: z.string().trim().min(1, 'Enter a title.').max(CONVERSATION_TITLE_MAX_LENGTH).optional(),
    visibility: conversationVisibilitySchema.optional(),
  })
  .refine((input) => input.title !== undefined || input.visibility !== undefined, {
    message: 'Nothing to change.',
  });
export type UpdateConversationInput = z.infer<typeof updateConversationInputSchema>;

export const sendMessageInputSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Ask a question.')
    .max(QUESTION_MAX_LENGTH, `Use at most ${QUESTION_MAX_LENGTH} characters.`),
});
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

// streaming: being written now. stopped: the user pressed Stop; what arrived is kept. failed: see `error`.
export const messageStatusSchema = z.enum(['streaming', 'complete', 'stopped', 'failed']);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const citationSchema = z.object({
  n: z.number(),
  chunkId: z.string(),
  documentId: z.string(),
  documentName: z.string(),
  page: z.number(),
  quote: z.string(),
});
export type Citation = z.infer<typeof citationSchema>;

export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  status: messageStatusSchema,
  error: z.string().nullable(),
  citations: z.array(citationSchema),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable(),
  // dollars for this answer; null when the model's price is not known
  costUsd: z.number().nullable(),
  // where the time went: finding passages, waiting for the first word, and everything
  latency: z
    .object({ retrievalMs: z.number(), ttftMs: z.number().nullable(), totalMs: z.number() })
    .nullable(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

// ---- tool calls ----

// proposed: waiting for a person. executed, rejected and failed are final. invalid: the model asked for something
// that does not exist or has the wrong arguments, so nobody was asked. expired: nobody decided in time.
export const toolCallStatusSchema = z.enum([
  'proposed',
  'executing',
  'executed',
  'rejected',
  'failed',
  'invalid',
  'expired',
]);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

export const toolCallSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  tool: z.string(),
  // what the model sent, shown to the person exactly as it will be used
  args: z.record(z.string(), z.unknown()),
  // one line saying what approving it will do
  description: z.string(),
  status: toolCallStatusSchema,
  proposedBy: z.string(),
  proposedByName: z.string(),
  decidedBy: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  result: z.object({ summary: z.string(), documentId: z.string().optional() }).nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const toolDecisionSchema = z.object({ decision: z.enum(['approve', 'reject']) });
export type ToolDecision = z.infer<typeof toolDecisionSchema>;

// What the server sends while an answer is written, as Server-Sent Events named after `type`.
export type ChatStreamEvent =
  | { type: 'start'; userMessageId: string; assistantMessageId: string }
  | { type: 'sources'; sources: { n: number; documentName: string; page: number }[] }
  | { type: 'token'; text: string }
  // the finished message, whatever way it ended: complete, stopped or failed
  | { type: 'done'; message: Message; toolCalls: ToolCall[] };
