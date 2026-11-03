import type { Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = 'atlas_session';
const SESSION_DAYS = 30;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(userId: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key(secret));
}

// Returns the user id, or null for a missing, forged or expired token.
export async function readSession(token: string | undefined, secret: string) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string, secure: boolean, domain?: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
    domain,
  });
}

export function clearSessionCookie(res: Response, secure: boolean, domain?: string) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure, path: '/', domain });
}
