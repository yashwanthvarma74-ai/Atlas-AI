import type { Core } from './core';
import { cancelIngest } from './queues';
import { hex } from './ids';

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
      const filter = { workspaceId: workspace._id };
      const documents = await core.database.documents.find(filter).toArray();
      // rows first, so a worker that is mid-way through a document finds nothing to bring back
      await core.database.documents.deleteMany(filter);
      await core.database.chunks.deleteMany(filter);
      await core.database.messages.deleteMany(filter);
      await core.database.conversations.deleteMany(filter);
      await core.database.toolCalls.deleteMany(filter);
      await core.database.memberships.deleteMany(filter);
      await core.database.workspaces.deleteOne({ _id: workspace._id });
      for (const doc of documents) {
        await cancelIngest(core.queues, hex(doc._id)).catch(() => undefined);
        await core.storage.delete(doc.storageKey);
      }
    }
    await core.database.memberships.deleteMany({ userId: guest._id });
    await core.database.users.deleteOne({ _id: guest._id });
  }
  if (guests.length > 0) core.logger.info({ removed: guests.length }, 'expired guests removed');
  return guests.length;
}
