import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ObjectId } from 'mongodb';
import type { z } from 'zod';
import { badRequest, notFound, parseId, type Config } from '@atlas/core';

// Parses untrusted input at the API boundary and turns a failure into a 400 with a readable message.
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw badRequest(result.error.issues[0]?.message ?? 'Invalid request.');
  return result.data;
}

// A path parameter that must be an id. Anything else is a plain "not found".
export function idParam(req: Request, name: string, what: string): ObjectId {
  const id = parseId(req.params[name]);
  if (!id) throw notFound(what);
  return id;
}

// A per-address limit for a route that costs something. Switched off under test so suites that make
// many requests are not throttled.
export function limit(config: Config, windowMs: number, max: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit: config.NODE_ENV === 'test' ? 100_000 : max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: { code: 'rate_limited', message: 'Too many requests. Try again in a little while.' },
    },
  });
}
