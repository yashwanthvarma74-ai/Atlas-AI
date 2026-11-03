import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt, from Node itself, so there is no native module to build. The cost parameters are stored with
// each hash, which lets them be raised later without locking anyone out: old hashes still verify, and
// new ones use the new cost.
const COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt needs 128 * N * r bytes, which is 32 MiB at this cost: right on Node's default limit, so raise it
const MAX_MEMORY = 128 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { ...options, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

// Format: scrypt$N$r$p$salt$hash, with the salt and hash in base64.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join(
    '$',
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;

  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
