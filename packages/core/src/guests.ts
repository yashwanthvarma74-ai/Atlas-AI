import { emptyWorkspace } from './cleanup';
import type { Core } from './core';

const BATCH = 50;

// Deletes guests older than the configured lifetime, with everything they own. A guest cannot sign in again, so an
// expired one is unreachable data. Returns how many accounts were removed.
export async function purgeExpiredGuests(core: Core, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - core.config.GUEST_TTL_HOURS * 60 * 60 * 1000);
  const guests = await core.database.users
    .find({ guest: true, createdAt: { $lt: cutoff } })
    .limit(BATCH)
    .toArray();

  for (const guest of guests) {
    const workspaces = await core.database.workspaces.find({ ownerId: guest._id }).toArray();
    for (const workspace of workspaces) {
      await emptyWorkspace(core, workspace._id);
      await core.database.memberships.deleteMany({ workspaceId: workspace._id });
      await core.database.workspaces.deleteOne({ _id: workspace._id });
    }
    await core.database.memberships.deleteMany({ userId: guest._id });
    await core.database.users.deleteOne({ _id: guest._id });
  }
  if (guests.length > 0) core.logger.info({ removed: guests.length }, 'expired guests removed');
  return guests.length;
}
