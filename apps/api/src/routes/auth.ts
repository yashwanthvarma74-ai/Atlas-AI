import { Router, type Response } from 'express';
import { loginInputSchema, registerInputSchema } from '@atlas/shared';
import {
  authenticate,
  clearOwnWorkspaces,
  createGuest,
  registerUser,
  toSessionUser,
  type Core,
} from '@atlas/core';
import { clearSessionCookie, setSessionCookie, signSession } from '../auth/session';
import { limit, parse } from '../http';
import { requireUser } from '../middleware';

const HOUR = 60 * 60 * 1000;

export function authRouter(core: Core): Router {
  const router = Router();
  const secure = core.config.COOKIE_SECURE ?? core.config.NODE_ENV === 'production';

  async function signIn(res: Response, userId: string) {
    setSessionCookie(
      res,
      await signSession(userId, core.config.JWT_SECRET),
      secure,
      core.config.COOKIE_DOMAIN,
    );
  }

  // Hashing a password is deliberately slow, so every route that does it is capped per address.
  router.post('/register', limit(core.config, HOUR, 10), async (req, res) => {
    const user = await registerUser(core, parse(registerInputSchema, req.body));
    await signIn(res, user._id.toHexString());
    res.status(201).json({ user: toSessionUser(user) });
  });

  router.post('/login', limit(core.config, 15 * 60 * 1000, 20), async (req, res) => {
    const user = await authenticate(core, parse(loginInputSchema, req.body));
    await signIn(res, user._id.toHexString());
    res.json({ user: toSessionUser(user) });
  });

  // Anyone can mint a guest, so the cost of doing it in a loop is capped per address.
  router.post('/guest', limit(core.config, HOUR, 20), async (_req, res) => {
    const user = await createGuest(core);
    await signIn(res, user._id.toHexString());
    res.status(201).json({ user: toSessionUser(user) });
  });

  router.get('/me', requireUser, (req, res) => {
    res.json({ user: toSessionUser(req.user!) });
  });

  // The demo's "every visit starts empty": the web app calls this when a page is loaded. It only ever touches the
  // caller's own workspaces, and does nothing unless the deployment turned it on.
  router.delete('/me/data', requireUser, async (req, res) => {
    if (!core.config.WIPE_ON_REFRESH) {
      res.status(204).end();
      return;
    }
    const removed = await clearOwnWorkspaces(core, req.user!._id);
    res.json({ removed });
  });

  router.post('/logout', (_req, res) => {
    clearSessionCookie(res, secure, core.config.COOKIE_DOMAIN);
    res.status(204).end();
  });

  return router;
}
