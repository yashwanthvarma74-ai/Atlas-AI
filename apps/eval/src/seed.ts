import { readdirSync, readFileSync } from 'node:fs';
import { ObjectId } from 'mongodb';
import { join } from 'node:path';
import { pino } from 'pino';
import {
  createCore,
  createWorkspace,
  listWorkspaces,
  loadConfig,
  registerUser,
  requireAccess,
  uploadDocument,
  type UserDoc,
} from '@atlas/core';
import { DATA_DIR } from './dataset';

// Fills a local database with something to look at: a demo account and a workspace holding the 30 documents the
// evaluation uses. Safe to run twice; it adds nothing the second time.
//
//   docker compose up -d && npm run seed        then run the API and worker, and sign in as the demo user
//
// The password below is for a database on this machine. Do not run this against a shared one.
const DEMO = { name: 'Demo', email: 'demo@atlas.test', password: 'demo-password-123' };

const config = loadConfig();
const core = await createCore(config, { logger: pino({ level: 'warn' }) });

try {
  const existing = await core.database.users.findOne({ email: DEMO.email });
  const user: UserDoc = existing ?? (await registerUser(core, DEMO));
  const [first] = await listWorkspaces(core, user._id);
  const workspace = first ?? (await createWorkspace(core, user, { name: 'Demo workspace' }));
  const access = await requireAccess(core, user._id, new ObjectId(workspace.id), 'owner');

  const have = new Set(
    (await core.database.documents.find({ workspaceId: access.workspaceId }).toArray()).map(
      (d) => d.name,
    ),
  );
  let added = 0;
  for (const name of readdirSync(join(DATA_DIR, 'corpus'))) {
    if (have.has(name)) continue;
    await uploadDocument(core, access, {
      name,
      bytes: readFileSync(join(DATA_DIR, 'corpus', name)),
    });
    added++;
  }
  console.log(`${added} documents queued in "${workspace.name}". Start the worker to index them.`);
  console.log(`Sign in as ${DEMO.email} with the password ${DEMO.password}.`);
} finally {
  await core.close();
}
