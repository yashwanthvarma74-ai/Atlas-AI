import type { ObjectId } from 'mongodb';
import { hasRole, type Role } from '@atlas/shared';
import type { Core } from './core';
import { forbidden, notFound } from './errors';

declare const checked: unique symbol;

// Proof that the server looked up this user's membership of this workspace. Every function that reads
// or writes a workspace's data takes one of these instead of a bare workspace id, and the only way to
// get one is requireAccess below. A route that forgets the check does not type-check (see ADR 0001).
export interface WorkspaceAccess {
  readonly [checked]: true;
  readonly workspaceId: ObjectId;
  readonly userId: ObjectId;
  readonly role: Role;
}

// Someone who is not in the workspace gets "not found", the same answer as for a workspace that does
// not exist, so ids cannot be probed. A member whose role is too low learns it is their role.
export async function requireAccess(
  core: Core,
  userId: ObjectId,
  workspaceId: ObjectId,
  minimum: Role = 'viewer',
): Promise<WorkspaceAccess> {
  const membership = await core.database.memberships.findOne({ workspaceId, userId });
  if (!membership) throw notFound('That workspace');
  if (!hasRole(membership.role, minimum)) {
    throw forbidden(
      minimum === 'owner'
        ? 'Only the owner can do that.'
        : 'Your role in this workspace does not allow that.',
    );
  }
  return { workspaceId, userId, role: membership.role } as WorkspaceAccess;
}
