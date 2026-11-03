import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGuest, purgeExpiredGuests, uploadDocument } from './index';
import { createTestCore, type TestCore } from './test/context';

let core: TestCore;
beforeAll(async () => {
  core = await createTestCore();
});
afterAll(() => core.destroy());

const day = 24 * 60 * 60 * 1000;

describe('guest cleanup', () => {
  it('removes an expired guest with their workspace and files, and keeps everyone else', async () => {
    const old = await createGuest(core);
    const fresh = await createGuest(core);
    const member = await core.user('keeper@guests.test');
    const access = await core.workspace(old);
    const doc = await uploadDocument(core, access, {
      name: 'notes.txt',
      bytes: new TextEncoder().encode('Revenue grew.'),
    });
    await core.database.users.updateOne(
      { _id: old._id },
      { $set: { createdAt: new Date(Date.now() - 2 * day) } },
    );

    const removed = await purgeExpiredGuests(core);

    expect(removed).toBe(1);
    expect(await core.database.users.findOne({ _id: old._id })).toBeNull();
    expect(await core.database.documents.countDocuments({ _id: new ObjectId(doc.id) })).toBe(0);
    expect(await core.database.memberships.countDocuments({ userId: old._id })).toBe(0);
    expect(await core.database.users.findOne({ _id: fresh._id })).not.toBeNull();
    expect(await core.database.users.findOne({ _id: member._id })).not.toBeNull();
  });

  it('never touches an old registered account', async () => {
    const user = await core.user('old@guests.test');
    await core.database.users.updateOne(
      { _id: user._id },
      { $set: { createdAt: new Date(Date.now() - 90 * day) } },
    );
    expect(await purgeExpiredGuests(core)).toBe(0);
    expect(await core.database.users.findOne({ _id: user._id })).not.toBeNull();
  });
});
