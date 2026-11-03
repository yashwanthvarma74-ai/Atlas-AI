import { z } from 'zod';

const DEV_SECRET = 'dev-only-secret-replace-before-deploying';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),

  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/atlas_ai'),

  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  // Every Redis key and queue name starts with this, so tests and apps never share state.
  REDIS_PREFIX: z.string().default('atlas'),

  // Where the original files are kept: "local" (a folder, for development) or "s3" (S3, R2 or MinIO).
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('../../.data/uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().default('atlas-uploads'),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // "hash" needs no service and no key: it makes vectors from word hashes, so it finds shared words but
  // not meaning. It exists for tests and for running the pipeline offline. Real answers need
  // "ollama" (local) or "openai".
  EMBEDDING_PROVIDER: z.enum(['hash', 'ollama', 'openai']).default('hash'),
  // defaults to nomic-embed-text for ollama and text-embedding-3-small for openai
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(256),
  OLLAMA_URL: z.string().default('http://127.0.0.1:11434'),
  OPENAI_API_KEY: z.string().optional(),

  // Chunk size in tokens (estimated at four characters each) and how much neighbouring chunks share.
  CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(256),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).default(32),
  // The longest any one ingest stage may run before the job is failed and retried.
  // How many passages a question gets (S1 to S8) and how many candidates each search contributes first.
  RETRIEVAL_LIMIT: z.coerce.number().int().positive().default(8),
  RETRIEVAL_POOL: z.coerce.number().int().positive().default(30),
  // "none" keeps the fused order; "coverage" boosts passages that contain the question's own words.
  // Off until the evaluation in week 5 shows it helps.
  RERANKER: z.enum(['none', 'coverage']).default('none'),

  // The first retry waits this long; each one after waits twice as long as the one before.
  INGEST_BACKOFF_MS: z.coerce.number().int().positive().default(2000),
  INGEST_STAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  JWT_SECRET: z.string().min(32).default(DEV_SECRET),
  // The browser origin that may send requests that change data.
  SITE_ORIGIN: z.string().default('http://localhost:3002'),
  // Set to the shared parent domain (for example .example.com) when the web app and the API sit on
  // sibling subdomains. Leave empty on localhost.
  COOKIE_DOMAIN: z.string().optional(),
  // How many proxies sit in front of the API (Vercel and Fly make two), so rate limits see the real visitor.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(env);
  if (config.NODE_ENV === 'production' && config.JWT_SECRET === DEV_SECRET) {
    throw new Error('JWT_SECRET must be set to a real secret in production.');
  }
  return config;
}
