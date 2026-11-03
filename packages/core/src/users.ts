import { randomInt } from 'node:crypto';
import { ObjectId } from 'mongodb';
import type { LoginInput, RegisterInput, SessionUser } from '@atlas/shared';
import type { Core } from './core';
import { isDuplicateKey, type UserDoc } from './db';
import { conflict, unauthorized } from './errors';
import { hex } from './ids';
import { hashPassword, verifyPassword } from './passwords';
import { createWorkspace } from './workspaces';

export const toSessionUser = (user: UserDoc): SessionUser => ({
  id: hex(user._id),
  name: user.name,
  email: user.email ?? null,
  guest: user.guest,
});

export async function registerUser(core: Core, input: RegisterInput): Promise<UserDoc> {
  const user: UserDoc = {
    _id: new ObjectId(),
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    guest: false,
    createdAt: new Date(),
  };
  try {
    await core.database.users.insertOne(user);
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict('An account with that email already exists.');
    throw error;
  }
  return user;
}

// Verified once and kept, so signing in as an address that has no account still pays for a hash and
// takes about as long as a wrong password does.
let decoyHash: Promise<string> | undefined;

export async function authenticate(core: Core, input: LoginInput): Promise<UserDoc> {
  const user = await core.database.users.findOne({ email: input.email });
  if (!user?.passwordHash) {
    decoyHash ??= hashPassword('decoy-for-timing-only');
    await verifyPassword(input.password, await decoyHash);
    throw unauthorized('Email or password is incorrect.');
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw unauthorized('Email or password is incorrect.');
  }
  return user;
}

// A guest is a real account that cannot sign in again. It starts with a workspace so a reviewer lands
// somewhere that already works, and without ever being asked for an email or a password.
export async function createGuest(core: Core): Promise<UserDoc> {
  const user: UserDoc = {
    _id: new ObjectId(),
    name: `Guest ${randomInt(1000, 10000)}`,
    guest: true,
    createdAt: new Date(),
  };
  await core.database.users.insertOne(user);
  await createWorkspace(core, user, { name: 'My workspace' });
  return user;
}
