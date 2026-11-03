import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate, createGuest, listWorkspaces, registerUser } from './index';
import { createTestCore, type TestCore } from './test/context';

let core: TestCore;
beforeAll(async () => {
  core = await createTestCore();
});
afterAll(() => core.destroy());

const ada = { name: 'Ada', email: 'ada@example.com', password: 'correct horse battery' };

describe('accounts', () => {
  it('registers a user and signs them in with the same password', async () => {
    const user = await registerUser(core, ada);
    expect(user.passwordHash).toBeDefined();
    expect(user.passwordHash).not.toContain(ada.password);

    const signedIn = await authenticate(core, { email: ada.email, password: ada.password });
    expect(signedIn._id.equals(user._id)).toBe(true);
  });

  it('refuses a second account on the same email', async () => {
    await expect(registerUser(core, ada)).rejects.toMatchObject({ status: 409 });
  });

  it('gives a wrong password and an unknown email the same answer', async () => {
    const wrongPassword = await authenticate(core, { email: ada.email, password: 'nope' }).catch(
      (e) => e,
    );
    const unknownEmail = await authenticate(core, {
      email: 'nobody@example.com',
      password: 'nope',
    }).catch((e) => e);

    expect(wrongPassword).toMatchObject({ status: 401 });
    expect(unknownEmail).toMatchObject({ status: 401 });
    expect(unknownEmail.message).toBe(wrongPassword.message);
  });

  it('does not let a guest sign in, because a guest has no password', async () => {
    const guest = await createGuest(core);
    expect(guest.email).toBeUndefined();
    await expect(authenticate(core, { email: '', password: 'x' })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('guests', () => {
  it('start with a workspace they own', async () => {
    const guest = await createGuest(core);
    const workspaces = await listWorkspaces(core, guest._id);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ name: 'My workspace', role: 'owner' });
  });

  it('are separate people, each with a workspace of their own', async () => {
    const [a, b] = await Promise.all([createGuest(core), createGuest(core)]);
    const [first, second] = await Promise.all([
      listWorkspaces(core, a._id),
      listWorkspaces(core, b._id),
    ]);
    expect(first[0]?.id).not.toBe(second[0]?.id);
  });
});
