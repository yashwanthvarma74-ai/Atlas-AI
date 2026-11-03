import { z } from 'zod';

const DEV_SECRET = 'dev-only-secret-replace-before-deploying';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4002),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),

  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/atlas_ai'),

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
