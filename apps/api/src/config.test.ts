import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './config.js';

const base = { DATABASE_URL: 'postgresql://example:dev@127.0.0.1:5432/learnspace' };
describe('local environment validation', () => {
  it('defaults to loopback and accepts an empty optional AI setup', () => {
    expect(parseEnvironment({ ...base, LEARNSPACE_TEXT_PROVIDER: '', OPENAI_API_KEY: '' }).API_HOST).toBe('127.0.0.1');
  });
  it.each([
    { API_HOST: '0.0.0.0' }, { API_PORT: 'not-a-port' }, { API_PORT: '65536' },
    { WEB_ORIGIN: 'https://evil.example' }, { WEB_ORIGIN: 'http://127.0.0.1:5173/path' },
    { DATABASE_URL: 'postgresql://user:do-not-disclose@remote.example/db' },
    { OLLAMA_BASE_URL: 'http://169.254.169.254' }, { LEARNSPACE_TEXT_PROVIDER: 'openai' }
  ])('rejects unsafe or incomplete configuration %j', change => {
    expect(() => parseEnvironment({ ...base, ...change })).toThrow('Invalid environment fields:');
  });
  it('does not include rejected secrets in error text', () => {
    try { parseEnvironment({ ...base, DATABASE_URL: 'postgresql://user:never-print-this@remote.example/db' }); }
    catch (error) { expect(String(error)).not.toContain('never-print-this'); }
  });
});
