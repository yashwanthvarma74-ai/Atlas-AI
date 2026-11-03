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
  EMBEDDING_PROVIDER: z.enum(['hash', 'ollama', 'openai', 'voyage', 'gemini']).default('hash'),
  // defaults to nomic-embed-text for ollama and text-embedding-3-small for openai
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(256),
  OLLAMA_URL: z.string().default('http://127.0.0.1:11434'),
  OPENAI_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),

  // Chunk size in tokens (estimated at four characters each) and how much neighbouring chunks share. The defaults
  // come from the evaluation sweep, with the reasoning in docs/EVALUATION.md and ADR 0005.
  CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(64),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).default(0),
  // The longest any one ingest stage may run before the job is failed and retried.
  // The model that writes answers. "extractive" needs no service and no key: it answers by quoting the
  // passages it is given, which is enough to run and test the whole chat pipeline offline. Real answers
  // need "openai", "anthropic" or "ollama".
  LLM_PROVIDER: z
    .enum(['extractive', 'openai', 'anthropic', 'gemini', 'ollama'])
    .default('extractive'),
  // defaults per provider: gpt-4o-mini, claude-haiku-5-5, llama3.2
  LLM_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // What the model costs, in dollars per million tokens. Needed for any provider whose price is not built in;
  // without both, the cost of an answer is recorded as unknown.
  LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).optional(),
  LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).optional(),
  // Only for the extractive provider: a pause between words, so streaming can be seen on screen.
  EXTRACTIVE_DELAY_MS: z.coerce.number().int().min(0).default(0),

  // Lets the model ask to use tools (today: save a note), each one waiting for a person to approve it.
  TOOLS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  // How long a proposed tool call waits for a decision before it lapses.
  TOOL_CALL_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1024),
  // How many earlier messages go to the model, and to the question rewriter, with a follow-up.
  CHAT_HISTORY_MESSAGES: z.coerce.number().int().min(0).default(6),
  // The model has this long to start answering, and this long in all, before the answer is stopped.
  CHAT_FIRST_TOKEN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  CHAT_TOTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // How many passages a question gets (S1 to S8) and how many candidates each search contributes first.
  RETRIEVAL_LIMIT: z.coerce.number().int().positive().default(8),
  RETRIEVAL_POOL: z.coerce.number().int().positive().default(30),
  // "none" keeps the fused order; "coverage" boosts passages that contain the question's own words.
  // On by default: the evaluation shows it raises recall@10 at every chunk size (docs/EVALUATION.md).
  RERANKER: z.enum(['none', 'coverage']).default('coverage'),

  // The first retry waits this long; each one after waits twice as long as the one before.
  INGEST_BACKOFF_MS: z.coerce.number().int().positive().default(2000),
  INGEST_STAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  JWT_SECRET: z.string().min(32).default(DEV_SECRET),
  // The browser origin that may send requests that change data.
  SITE_ORIGIN: z.string().default('http://localhost:3002'),
  // Set to the shared parent domain (for example .example.com) when the web app and the API sit on
  // sibling subdomains. Leave empty on localhost.
  COOKIE_DOMAIN: z.string().optional(),
  // Whether the session cookie is marked Secure (sent only over HTTPS). Defaults to on in production. Turn it off
  // only to run the production build over plain HTTP on one machine, as docker compose does.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  // Multiplies every per-address rate limit. Leave at 1. It exists so a load test can measure the service rather
  // than the limiter, and a deployment that raises it has removed a defence.
  RATE_LIMIT_SCALE: z.coerce.number().positive().default(1),
  // Run the ingest worker inside the API process. For hosts that give one free service and no background workers;
  // anywhere else, run the worker on its own so uploads and chat scale and fail separately.
  INLINE_WORKER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // How long a guest account and its workspace live before the worker deletes them.
  GUEST_TTL_HOURS: z.coerce.number().positive().default(24),
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
