import { ObjectId } from 'mongodb';

// Ids arrive as strings in URLs and bodies. Anything that is not a valid id is "not found", never a crash.
export function parseId(value: unknown): ObjectId | null {
  return typeof value === 'string' && /^[0-9a-f]{24}$/.test(value) ? new ObjectId(value) : null;
}

export const hex = (id: ObjectId): string => id.toHexString();
