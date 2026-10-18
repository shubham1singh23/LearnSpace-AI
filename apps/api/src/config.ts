import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

export const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const blankOptional = (schema: z.ZodType<string>) => z.preprocess(value => value === '' ? undefined : value, schema.optional());
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const localUrl = z.url().refine(value => {
  const url = new URL(value);
  return loopback.has(url.hostname);
}, 'Must use a loopback hostname');
const provider = z.enum(['openai', 'anthropic', 'google', 'ollama']);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: localUrl.refine(value => {
    const url = new URL(value);
    return url.protocol === 'http:' && url.origin === value && !url.username && !url.password;
  }, 'Use a plain loopback HTTP origin without path or credentials').default('http://127.0.0.1:5173'),
  DATABASE_URL: localUrl.refine(value => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), 'Expected PostgreSQL URL'),
  DATA_DIR: z.string().min(1).default('./data'),
  LEARNSPACE_TEXT_PROVIDER: blankOptional(provider), LEARNSPACE_TEXT_MODEL: blankOptional(z.string().min(1).max(160)),
  LEARNSPACE_IMAGE_PROVIDER: blankOptional(provider), LEARNSPACE_IMAGE_MODEL: blankOptional(z.string().min(1).max(160)),
  OPENAI_API_KEY: blankOptional(z.string().min(1).max(4096)), ANTHROPIC_API_KEY: blankOptional(z.string().min(1).max(4096)), GOOGLE_API_KEY: blankOptional(z.string().min(1).max(4096)),
  OLLAMA_BASE_URL: localUrl.refine(value => {
    const url = new URL(value);
    return url.protocol === 'http:' && !url.username && !url.password && !url.search && !url.hash;
  }, 'Expected loopback HTTP Ollama URL').default('http://127.0.0.1:11434')
}).superRefine((env, ctx) => {
  for (const [p, m] of [[env.LEARNSPACE_TEXT_PROVIDER, env.LEARNSPACE_TEXT_MODEL], [env.LEARNSPACE_IMAGE_PROVIDER, env.LEARNSPACE_IMAGE_MODEL]]) {
    if (Boolean(p) !== Boolean(m)) ctx.addIssue({ code: 'custom', path: ['modelConfiguration'], message: 'Provider and model must be set together' });
  }
});
export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(input: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(input);
  // Zod errors can include input values: expose field names only, never serialize the error.
  if (!result.success) throw new Error(`Invalid environment fields: ${[...new Set(result.error.issues.map(issue => issue.path.join('.') || 'configuration'))].join(', ')}`);
  return result.data;
}
export function loadEnvironment(): Environment {
  loadDotenv({ path: resolve(workspaceRoot, '.env'), quiet: true });
  return parseEnvironment(process.env);
}
