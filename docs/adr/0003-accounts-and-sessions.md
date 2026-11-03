# 0003. Accounts, sessions and guests

Status: accepted

## Context

Reviewers should be able to try Atlas AI in one click, without registering. Real users need real accounts, and a
workspace is only private if sign-in is sound.

## Decision

**Passwords** are hashed with scrypt from `node:crypto` (N = 2^15, r = 8, p = 1, 16-byte random salt, NFKC
normalised). The cost parameters are stored in each hash record, so they can be raised later without locking
anyone out. Verification uses `timingSafeEqual`. There is no native module to build.

**Sessions** are an HS256 JWT in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production) holding only the
user id, valid for 30 days. The API reads the user from MongoDB on every request, so deleting an account ends its
sessions at once. Nothing about roles is in the token (see [0001](0001-workspace-access-is-proved-by-a-type.md)).

**Sign-in does not reveal whether an address has an account.** A wrong password and an unknown email return the
same status and message. For an unknown address the server still verifies the password against a stored decoy
hash, so the two cases take about the same time.

**Guests** are real accounts without an email or password, created by one request and given a workspace of their
own. They cannot sign in again, so closing the browser ends the guest. Creating one is rate limited per address.

**Writes check their origin.** A browser always sends `Origin` on a cross-site write. A request that changes data
and names an origin other than the web app's is refused with 403. This backs up `SameSite=Lax` for older browsers.

**Rate limits** apply to registration (10 an hour), sign-in (20 per 15 minutes) and guest creation (20 an hour),
per address, because each of them costs a password hash or a database write that anyone can trigger.

## Consequences

- Registering with an address that is taken says so (409). That does tell a visitor the address has an account;
  hiding it would need an email-verification flow, which Atlas does not have. The rate limit bounds the probing.
- Adding a person to a workspace by email tells the owner whether that address has an account.
- Guests accumulate. A cleanup job for guests who have been idle for a while belongs with the other background
  jobs in week 2.
- Rotating `JWT_SECRET` signs everyone out. There is no refresh token and no server-side session list.

## Alternatives

- **bcrypt or argon2.** Both are fine. argon2 needs a native build, and bcrypt truncates long passwords. scrypt
  ships with Node.
- **Session ids in MongoDB.** Gives instant logout of one device. The user lookup on every request already gives
  instant logout of an account, which is the case that matters here.
- **OAuth only.** Removes password handling, and puts a third party between a reviewer and the demo.
