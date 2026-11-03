import { z } from 'zod';
import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
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
