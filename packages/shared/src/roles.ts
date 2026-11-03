import type { Role } from './schemas';

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

// True when `role` is `required` or stronger.
export const hasRole = (role: Role, required: Role): boolean => RANK[role] >= RANK[required];
