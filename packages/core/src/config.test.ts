import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('has defaults that work on a laptop', () => {
    const config = loadConfig({});
    expect(config.API_PORT).toBe(4002);
    expect(config.MONGODB_URI).toContain('127.0.0.1');
  });

  it('refuses the development secret in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('JWT_SECRET');
  });

  it('accepts a real secret in production', () => {
    const secret = 'x'.repeat(48);
    expect(loadConfig({ NODE_ENV: 'production', JWT_SECRET: secret }).JWT_SECRET).toBe(secret);
  });

  it('rejects a secret too short to sign anything safely', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short' })).toThrow();
  });
});
