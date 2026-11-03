import { ObjectId } from 'mongodb';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MemberRole } from '@atlas/shared';
import {
  addMember,
  changeMemberRole,
  createWorkspace,
  getWorkspace,
  listMembers,
  listWorkspaces,
  removeMember,
  requireAccess,
  type UserDoc,
} from './index';
import { createTestCore, type TestCore } from './test/context';

let core: TestCore;
beforeAll(async () => {
  core = await createTestCore();
});
afterAll(() => core.destroy());

async function workspaceWith(owner: UserDoc, members: Record<string, MemberRole> = {}) {
  const workspace = await createWorkspace(core, owner, { name: 'Research' });
  const ownerAccess = await requireAccess(core, owner._id, new ObjectId(workspace.id), 'owner');
  for (const [email, role] of Object.entries(members)) {
    await addMember(core, ownerAccess, { email, role });
  }
  return { id: new ObjectId(workspace.id), ownerAccess };
}

describe('requireAccess', () => {
  it('answers "not found" for an outsider, exactly as for a workspace that does not exist', async () => {
    const owner = await core.user('owner@a.test');
    const outsider = await core.user('outsider@a.test');
    const { id } = await workspaceWith(owner);

    const real = await requireAccess(core, outsider._id, id).catch((e) => e);
    const missing = await requireAccess(core, outsider._id, new ObjectId()).catch((e) => e);

    expect(real).toMatchObject({ status: 404 });
    expect(missing).toMatchObject({ status: 404 });
    expect(real.message).toBe(missing.message);
  });

  it('tells a member that their role is the problem', async () => {
    const owner = await core.user('owner@b.test');
    const viewer = await core.user('viewer@b.test');
    const { id } = await workspaceWith(owner, { 'viewer@b.test': 'viewer' });

    await expect(requireAccess(core, viewer._id, id, 'editor')).rejects.toMatchObject({
      status: 403,
    });
    await expect(requireAccess(core, viewer._id, id, 'viewer')).resolves.toMatchObject({
      role: 'viewer',
    });
  });

  it('grants access to exactly the people who are members, whatever the membership layout', async () => {
    const people = await Promise.all(
      Array.from({ length: 6 }, (_, i) => core.user(`person${i}@prop.test`)),
    );
    const workspaces = await Promise.all(people.slice(0, 3).map((owner) => workspaceWith(owner)));

    // a random subset of the other people is added to each workspace as a viewer or an editor
    const layout = fc.array(
      fc.record({
        workspace: fc.integer({ min: 0, max: 2 }),
        person: fc.integer({ min: 3, max: 5 }),
        role: fc.constantFrom<MemberRole>('viewer', 'editor'),
      }),
      { maxLength: 9 },
    );

    await fc.assert(
      fc.asyncProperty(layout, async (grants) => {
        await core.database.memberships.deleteMany({ role: { $ne: 'owner' } });
        const expected = new Map<string, string>();
        for (const { workspace, person, role } of grants) {
          const key = `${workspace}:${person}`;
          if (expected.has(key)) continue;
          expected.set(key, role);
          await addMember(core, workspaces[workspace]!.ownerAccess, {
            email: `person${person}@prop.test`,
            role,
          });
        }

        for (let w = 0; w < workspaces.length; w++) {
          for (let p = 0; p < people.length; p++) {
            const result = await requireAccess(core, people[p]!._id, workspaces[w]!.id).then(
              (access) => access.role,
              (error) => error.status as number,
            );
            const owns = p === w;
            const granted = expected.get(`${w}:${p}`);
            expect(result).toBe(owns ? 'owner' : (granted ?? 404));
          }
        }
      }),
      { numRuns: 25 },
    );
  });
});

describe('workspaces', () => {
  it('lists only the workspaces a user belongs to', async () => {
    const ada = await core.user('ada@list.test');
    const grace = await core.user('grace@list.test');
    await createWorkspace(core, ada, { name: 'Ada only' });
    await createWorkspace(core, grace, { name: 'Grace only' });
    const shared = await workspaceWith(ada, { 'grace@list.test': 'viewer' });

    const adas = await listWorkspaces(core, ada._id);
    const graces = await listWorkspaces(core, grace._id);

    expect(adas.map((w) => w.name).sort()).toEqual(['Ada only', 'Research']);
    expect(graces.map((w) => w.name).sort()).toEqual(['Grace only', 'Research']);
    expect(graces.find((w) => w.id === shared.id.toHexString())?.role).toBe('viewer');
  });

  it('returns a workspace together with the caller role', async () => {
    const owner = await core.user('owner@get.test');
    const { ownerAccess } = await workspaceWith(owner);
    expect(await getWorkspace(core, ownerAccess)).toMatchObject({
      name: 'Research',
      role: 'owner',
    });
  });
});

describe('members', () => {
  it('lists the owner first and everyone after in the order they joined', async () => {
    const owner = await core.user('owner@members.test');
    await core.user('a@members.test');
    await core.user('b@members.test');
    const { ownerAccess } = await workspaceWith(owner, {
      'a@members.test': 'editor',
      'b@members.test': 'viewer',
    });

    const members = await listMembers(core, ownerAccess);
    expect(members.map((m) => [m.email, m.role])).toEqual([
      ['owner@members.test', 'owner'],
      ['a@members.test', 'editor'],
      ['b@members.test', 'viewer'],
    ]);
  });

  it('cannot add someone who has no account, or add the same person twice', async () => {
    const owner = await core.user('owner@add.test');
    await core.user('twice@add.test');
    const { ownerAccess } = await workspaceWith(owner);

    await expect(
      addMember(core, ownerAccess, { email: 'ghost@add.test', role: 'viewer' }),
    ).rejects.toMatchObject({ status: 404 });

    await addMember(core, ownerAccess, { email: 'twice@add.test', role: 'viewer' });
    await expect(
      addMember(core, ownerAccess, { email: 'twice@add.test', role: 'editor' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('changes a role, and refuses to touch the owner', async () => {
    const owner = await core.user('owner@role.test');
    const editor = await core.user('editor@role.test');
    const { ownerAccess } = await workspaceWith(owner, { 'editor@role.test': 'editor' });

    await changeMemberRole(core, ownerAccess, editor._id, 'viewer');
    const after = await requireAccess(core, editor._id, ownerAccess.workspaceId);
    expect(after.role).toBe('viewer');

    await expect(changeMemberRole(core, ownerAccess, owner._id, 'viewer')).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      changeMemberRole(core, ownerAccess, new ObjectId(), 'viewer'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lets the owner remove a member and lets a member leave', async () => {
    const owner = await core.user('owner@remove.test');
    const kicked = await core.user('kicked@remove.test');
    const leaver = await core.user('leaver@remove.test');
    const { id, ownerAccess } = await workspaceWith(owner, {
      'kicked@remove.test': 'editor',
      'leaver@remove.test': 'viewer',
    });

    await removeMember(core, ownerAccess, kicked._id);
    await expect(requireAccess(core, kicked._id, id)).rejects.toMatchObject({ status: 404 });

    const leaverAccess = await requireAccess(core, leaver._id, id);
    await removeMember(core, leaverAccess, leaver._id);
    await expect(requireAccess(core, leaver._id, id)).rejects.toMatchObject({ status: 404 });
  });

  it('does not let a member remove anyone else, and never lets the owner go', async () => {
    const owner = await core.user('owner@guard.test');
    const editor = await core.user('editor@guard.test');
    const { id, ownerAccess } = await workspaceWith(owner, { 'editor@guard.test': 'editor' });
    const editorAccess = await requireAccess(core, editor._id, id);

    await expect(removeMember(core, editorAccess, owner._id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(removeMember(core, ownerAccess, owner._id)).rejects.toMatchObject({ status: 403 });
    await expect(requireAccess(core, owner._id, id)).resolves.toMatchObject({ role: 'owner' });
  });
});
