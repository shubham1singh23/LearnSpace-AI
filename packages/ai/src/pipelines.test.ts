import { expect, it } from 'vitest';
import { z } from 'zod';
import { structured } from './pipelines.js';
import { ModelError } from './transport.js';

it('bounds schema repair to one call and preserves the captured input', async () => {
  const seen: string[] = [];
  const adapter = { async generate<T>(_system: string, input: string, schema: z.ZodType<T>) { seen.push(input); if (seen.length === 1) throw new ModelError('INVALID_OUTPUT'); return schema.parse({ ok: true }); } };
  expect(await structured(adapter, 'JSON', 'immutable captured context', z.object({ ok: z.boolean() }), new AbortController().signal)).toEqual({ ok: true });
  expect(seen).toEqual(['immutable captured context', 'immutable captured context']);
  let calls = 0;
  await expect(structured({ async generate() { calls++; throw new ModelError('INVALID_OUTPUT'); } }, 'JSON', 'same', z.object({}), new AbortController().signal)).rejects.toThrow('INVALID_OUTPUT'); expect(calls).toBe(2);
});
