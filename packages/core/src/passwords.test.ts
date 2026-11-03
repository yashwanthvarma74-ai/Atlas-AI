import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords';

describe('passwords', () => {
  it('verifies the password that was hashed', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects any other password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts every hash, so equal passwords do not produce equal records', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same password'),
      hashPassword('same password'),
    ]);
    expect(a).not.toBe(b);
  });

  it('never stores the password itself', async () => {
    expect(await hashPassword('plain-text-secret')).not.toContain('plain-text-secret');
  });

  it('treats equivalent Unicode spellings as the same password', async () => {
    const stored = await hashPassword('café au lait 123');
    expect(await verifyPassword('café au lait 123', stored)).toBe(true);
  });

  it('refuses a record it does not recognise instead of throwing', async () => {
    expect(await verifyPassword('anything', 'plaintext')).toBe(false);
    expect(await verifyPassword('anything', 'bcrypt$1$2$3$4$5')).toBe(false);
  });
});
