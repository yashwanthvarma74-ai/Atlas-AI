export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = (message = 'Sign in to continue.') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You cannot do that.') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (what = 'That') =>
  new HttpError(404, 'not_found', `${what} was not found.`);
export const badRequest = (message: string, code = 'invalid_request') =>
  new HttpError(400, code, message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
