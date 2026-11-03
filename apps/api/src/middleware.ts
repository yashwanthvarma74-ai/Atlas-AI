import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ObjectId } from 'mongodb';
import type { Logger } from 'pino';
import { forbidden, HttpError, unauthorized, type Core, type UserDoc } from '@atlas/core';
import { readSession, SESSION_COOKIE } from './auth/session';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserDoc;
  }
}

// Loads the signed-in user, if there is a valid session, onto the request. The user is read from the
// database every time, so deleting an account ends its sessions at once.
export function loadUser(core: Core): RequestHandler {
  return async (req, _res, next) => {
    const userId = await readSession(req.cookies?.[SESSION_COOKIE], core.config.JWT_SECRET);
    if (userId && ObjectId.isValid(userId)) {
      req.user = (await core.database.users.findOne({ _id: new ObjectId(userId) })) ?? undefined;
    }
    next();
  };
}

export const requireUser: RequestHandler = (req, _res, next) => {
  next(req.user ? undefined : unauthorized());
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// The session cookie is SameSite=Lax, which already keeps other sites from sending it with a POST.
// This closes the remaining gap for older browsers: a request that changes data and names an origin
// other than the web app's is refused. Requests with no Origin header (curl, the tests) pass, because
// a browser always sends one on a cross-site write.
export function sameOrigin(allowed: string): RequestHandler {
  return (req, _res, next) => {
    const origin = req.get('origin');
    const refused = !SAFE_METHODS.has(req.method) && origin !== undefined && origin !== allowed;
    next(refused ? forbidden('Requests from that origin are not allowed.') : undefined);
  };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  // Express recognises an error handler by its four parameters, so _next has to stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (error, _req, res, _next) => {
    // a stream that has started cannot become an error response; the connection is simply closed
    if (res.headersSent) {
      logger.error({ err: error }, 'error after the response started');
      res.end();
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if ((error as { type?: unknown }).type === 'entity.too.large') {
      res
        .status(413)
        .json({ error: { code: 'too_large', message: 'That is too large to accept.' } });
      return;
    }
    // Malformed JSON and other bad bodies are rejected by the body parser with their own status.
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res
        .status(status)
        .json({ error: { code: 'bad_request', message: 'The request is not valid.' } });
      return;
    }
    logger.error({ err: error }, 'unhandled error');
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong.' } });
  };
}
