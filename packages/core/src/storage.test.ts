import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { createLocalStorage, createS3Storage, type Storage } from './storage';

const bytes = (text: string) => new TextEncoder().encode(text);

// The same behaviour is required of every driver, so one suite runs against each.
function behavesLikeStorage(make: () => Promise<Storage> | Storage, expectsLink: boolean) {
  let storage: Storage;
  beforeAll(async () => {
    storage = await make();
  });

  it('returns exactly the bytes that were stored', async () => {
    const data = Uint8Array.from({ length: 256 }, (_, i) => i);
    await storage.put('ws1/doc1', data, 'application/octet-stream');
    expect(await storage.get('ws1/doc1')).toEqual(data);
  });

  it('replaces an object stored under the same key', async () => {
    await storage.put('ws1/replace', bytes('first'), 'text/plain');
    await storage.put('ws1/replace', bytes('second'), 'text/plain');
    expect(new TextDecoder().decode(await storage.get('ws1/replace'))).toBe('second');
  });

  it('deletes an object, and deleting it again is not an error', async () => {
    await storage.put('ws1/gone', bytes('x'), 'text/plain');
    await storage.delete('ws1/gone');
    await expect(storage.get('ws1/gone')).rejects.toThrow();
    await expect(storage.delete('ws1/gone')).resolves.toBeUndefined();
  });

  it(
    expectsLink ? 'offers a time-limited download link' : 'has no link, so the API streams',
    async () => {
      const url = await storage.downloadUrl('ws1/doc1', 'Q3 report.pdf', 60);
      if (expectsLink) {
        expect(url).toContain('X-Amz-Expires=60');
        expect(url).toContain('Q3%2520report.pdf');
      } else {
        expect(url).toBeNull();
      }
    },
  );
}

describe('local storage', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'atlas-storage-'));
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  behavesLikeStorage(() => createLocalStorage(root), false);

  it('refuses a key that climbs out of the folder', async () => {
    const storage = createLocalStorage(root);
    await expect(storage.put('../escape', bytes('x'), 'text/plain')).rejects.toThrow('escapes');
    await expect(storage.get('/etc/passwd')).rejects.toThrow('escapes');
    await expect(storage.delete('ws1/../../escape')).rejects.toThrow('escapes');
    expect(await readdir(join(root, '..')).then((names) => names.includes('escape'))).toBe(false);
  });
});

// Needs an S3-compatible server: docker run -p 9090:9090 -e COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=atlas-test adobe/s3mock
const endpoint = process.env.S3_TEST_ENDPOINT;
describe.skipIf(!endpoint)('S3 storage', () => {
  behavesLikeStorage(
    () =>
      createS3Storage(
        loadConfig({
          STORAGE_DRIVER: 's3',
          S3_ENDPOINT: endpoint,
          S3_BUCKET: 'atlas-test',
          S3_REGION: 'us-east-1',
          S3_ACCESS_KEY_ID: 'test',
          S3_SECRET_ACCESS_KEY: 'test',
        }),
      ),
    true,
  );
});
