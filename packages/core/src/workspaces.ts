import { ObjectId } from 'mongodb';
import type {
  AddMemberInput,
  CreateWorkspaceInput,
  Member,
  MemberRole,
  Workspace,
} from '@atlas/shared';
import type { WorkspaceAccess } from './access';
import type { Core } from './core';
import { isDuplicateKey, type MembershipDoc, type UserDoc, type WorkspaceDoc } from './db';
import { conflict, forbidden, notFound } from './errors';
import { hex } from './ids';

const toWorkspace = (workspace: WorkspaceDoc, role: MembershipDoc['role']): Workspace => ({
  id: hex(workspace._id),
  name: workspace.name,
  role,
  createdAt: workspace.createdAt.toISOString(),
});

export async function createWorkspace(
  core: Core,
  owner: UserDoc,
  input: CreateWorkspaceInput,
): Promise<Workspace> {
  const now = new Date();
  const workspace: WorkspaceDoc = {
    _id: new ObjectId(),
    name: input.name,
    ownerId: owner._id,
    createdAt: now,
  };
  await core.database.workspaces.insertOne(workspace);
  try {
    await core.database.memberships.insertOne({
      _id: new ObjectId(),
      workspaceId: workspace._id,
      userId: owner._id,
      role: 'owner',
      createdAt: now,
    });
  } catch (error) {
    // A workspace nobody belongs to can never be opened, so do not leave one behind.
    await core.database.workspaces.deleteOne({ _id: workspace._id });
    throw error;
  }
  return toWorkspace(workspace, 'owner');
}

export async function listWorkspaces(core: Core, userId: ObjectId): Promise<Workspace[]> {
  const memberships = await core.database.memberships
    .find({ userId })
    .sort({ createdAt: 1 })
    .toArray();
  const workspaces = await core.database.workspaces
    .find({ _id: { $in: memberships.map((m) => m.workspaceId) } })
    .toArray();
  const byId = new Map(workspaces.map((w) => [hex(w._id), w]));

  return memberships.flatMap((membership) => {
    const workspace = byId.get(hex(membership.workspaceId));
    return workspace ? [toWorkspace(workspace, membership.role)] : [];
  });
}

export async function getWorkspace(core: Core, access: WorkspaceAccess): Promise<Workspace> {
  const workspace = await core.database.workspaces.findOne({ _id: access.workspaceId });
  if (!workspace) throw notFound('That workspace');
  return toWorkspace(workspace, access.role);
}

export async function listMembers(core: Core, access: WorkspaceAccess): Promise<Member[]> {
  const memberships = await core.database.memberships
    .find({ workspaceId: access.workspaceId })
    .sort({ createdAt: 1 })
    .toArray();
  const users = await core.database.users
    .find({ _id: { $in: memberships.map((m) => m.userId) } })
    .toArray();
  const byId = new Map(users.map((u) => [hex(u._id), u]));

  return memberships.flatMap((membership) => {
    const user = byId.get(hex(membership.userId));
    if (!user) return [];
    return [
      {
        userId: hex(user._id),
        name: user.name,
        email: user.email ?? null,
        role: membership.role,
        joinedAt: membership.createdAt.toISOString(),
      },
    ];
  });
}

// The caller has already proven they are the owner (requireAccess with 'owner').
export async function addMember(
  core: Core,
  access: WorkspaceAccess,
  input: AddMemberInput,
): Promise<Member> {
  const user = await core.database.users.findOne({ email: input.email });
  if (!user) throw notFound('An account with that email');

  const membership: MembershipDoc = {
    _id: new ObjectId(),
    workspaceId: access.workspaceId,
    userId: user._id,
    role: input.role,
    createdAt: new Date(),
  };
  try {
    await core.database.memberships.insertOne(membership);
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict('That person is already in this workspace.');
    throw error;
  }
  return {
    userId: hex(user._id),
    name: user.name,
    email: user.email ?? null,
    role: membership.role,
    joinedAt: membership.createdAt.toISOString(),
  };
}

export async function changeMemberRole(
  core: Core,
  access: WorkspaceAccess,
  userId: ObjectId,
  role: MemberRole,
): Promise<void> {
  // the owner filter is part of the update itself, so a stale read cannot demote the owner
  const result = await core.database.memberships.updateOne(
    { workspaceId: access.workspaceId, userId, role: { $ne: 'owner' } },
    { $set: { role } },
  );
  if (result.matchedCount === 0) await explainMissingMember(core, access, userId);
}

// An owner can remove anyone but themselves. Anyone else can only remove themselves, which is
// leaving. The owner cannot leave, because a workspace with no owner has nobody to manage it.
export async function removeMember(
  core: Core,
  access: WorkspaceAccess,
  userId: ObjectId,
): Promise<void> {
  const isSelf = access.userId.equals(userId);
  if (!isSelf && access.role !== 'owner')
    throw forbidden('Only the owner can remove other people.');

  const result = await core.database.memberships.deleteOne({
    workspaceId: access.workspaceId,
    userId,
    role: { $ne: 'owner' },
  });
  if (result.deletedCount === 0) await explainMissingMember(core, access, userId);
}

// An update or delete that matched nothing means either the person is not here or they are the owner.
async function explainMissingMember(
  core: Core,
  access: WorkspaceAccess,
  userId: ObjectId,
): Promise<never> {
  const membership = await core.database.memberships.findOne({
    workspaceId: access.workspaceId,
    userId,
  });
  if (membership?.role === 'owner') throw forbidden('The owner cannot be changed or removed.');
  throw notFound('That member');
}
