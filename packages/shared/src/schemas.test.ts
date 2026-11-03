import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './limits';
import { hasRole } from './roles';
import {
  addMemberInputSchema,
  createWorkspaceInputSchema,
  loginInputSchema,
  registerInputSchema,
} from './schemas';

describe('registerInputSchema', () => {
  const valid = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'correct horse battery',
  };

  it('accepts a complete registration', () => {
    expect(registerInputSchema.parse(valid)).toEqual(valid);
  });

  it('trims the name and folds the email to lower case', () => {
    const parsed = registerInputSchema.parse({
      ...valid,
      name: '  Ada  ',
      email: '  Ada@Example.COM ',
    });
    expect(parsed.name).toBe('Ada');
    expect(parsed.email).toBe('ada@example.com');
  });

  it('rejects a short password and says how long it must be', () => {
    const result = registerInputSchema.safeParse({
      ...valid,
      password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it('rejects a password long enough to be used as a CPU sink', () => {
    const result = registerInputSchema.safeParse({
      ...valid,
      password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed email and a blank name', () => {
    expect(registerInputSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
    expect(registerInputSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });
});

describe('loginInputSchema', () => {
  it('does not enforce the password length rules', () => {
    expect(
      loginInputSchema.safeParse({ email: 'ada@example.com', password: 'short' }).success,
    ).toBe(true);
  });

  it('still requires a password', () => {
    expect(loginInputSchema.safeParse({ email: 'ada@example.com', password: '' }).success).toBe(
      false,
    );
  });
});

describe('workspace schemas', () => {
  it('requires a name', () => {
    expect(createWorkspaceInputSchema.safeParse({ name: ' ' }).success).toBe(false);
  });

  it('never lets a member be given the owner role', () => {
    expect(addMemberInputSchema.safeParse({ email: 'a@b.co', role: 'owner' }).success).toBe(false);
    expect(addMemberInputSchema.safeParse({ email: 'a@b.co', role: 'editor' }).success).toBe(true);
  });
});

describe('hasRole', () => {
  it('orders viewer below editor below owner', () => {
    expect(hasRole('owner', 'editor')).toBe(true);
    expect(hasRole('editor', 'editor')).toBe(true);
    expect(hasRole('viewer', 'editor')).toBe(false);
    expect(hasRole('editor', 'owner')).toBe(false);
  });
});
