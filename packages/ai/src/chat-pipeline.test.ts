import { expect, it } from 'vitest';
import { generateChat } from './chat-pipeline.js';
import { ModelError, type TextAdapter } from './adapters.js';

it('uses an untrusted-context plain-text boundary and never repairs malformed output automatically', async () => {
  let calls = 0;
  const adapter: TextAdapter = { async generate(system, input, schema) {
    calls++; expect(system).toContain('untrusted data'); expect(system).toContain('do not fabricate'); expect(input).toContain('saved');
    const parsed = schema.safeParse({ text: 'Literal <b>answer</b>' }); if (!parsed.success) throw new ModelError('INVALID_OUTPUT'); return parsed.data;
  } };
  expect(await generateChat(adapter, 'saved customized notes', new AbortController().signal)).toEqual({ text: 'Literal <b>answer</b>' });
  expect(calls).toBe(1);
  const invalid: TextAdapter = { async generate() { calls++; throw new ModelError('INVALID_OUTPUT'); } };
  await expect(generateChat(invalid, 'saved', new AbortController().signal)).rejects.toThrow(); expect(calls).toBe(2);
});
