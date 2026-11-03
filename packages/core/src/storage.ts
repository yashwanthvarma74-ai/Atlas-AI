import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from './config';

// Where the original files live. The database holds a key, never the bytes.
export interface Storage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  // Removing something that is not there is not an error, so a retried delete is safe.
  delete(key: string): Promise<void>;
  // A short-lived link the browser can download from directly, or null when this driver has none and
  // the API has to stream the file itself.
  downloadUrl(key: string, filename: string, expiresInSeconds: number): Promise<string | null>;
}

export function createLocalStorage(root: string): Storage {
  const base = resolve(root);

  // Keys are made by the server, but a key that escapes the folder would be a file read or write
  // anywhere on the disk, so the path is checked rather than trusted.
  const pathFor = (key: string) => {
    const path = resolve(base, key);
    if (!path.startsWith(base + sep))
      throw new Error(`Storage key escapes the upload folder: ${key}`);
    return path;
  };

  return {
    async put(key, bytes) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async get(key) {
      return new Uint8Array(await readFile(pathFor(key)));
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
    downloadUrl: async () => null,
  };
}

export function createS3Storage(config: Config): Storage {
  const client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    // MinIO and most local S3 servers address the bucket in the path, not the host name
    forcePathStyle: Boolean(config.S3_ENDPOINT),
    credentials:
      config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  const Bucket = config.S3_BUCKET;

  return {
    async put(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: contentType }),
      );
    },
    async get(key) {
      const { Body } = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!Body) throw new Error(`Storage object has no body: ${key}`);
      return Body.transformToByteArray();
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    downloadUrl(key, filename, expiresInSeconds) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          // the browser saves it under the user's name for it, and never renders it in place
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        }),
        { expiresIn: expiresInSeconds },
      );
    },
  };
}

export function createStorage(config: Config): Storage {
  return config.STORAGE_DRIVER === 's3'
    ? createS3Storage(config)
    : createLocalStorage(config.UPLOAD_DIR);
}
