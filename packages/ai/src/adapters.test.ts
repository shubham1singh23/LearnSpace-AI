import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { modelSnapshotSchema, type TextProvider } from '@learnspace/shared';
import { capabilities, createTextAdapter } from './adapters.js';
import { guardedFetch, providerEndpoint } from './transport.js';

const providers: TextProvider[] = ['openai', 'anthropic', 'google', 'ollama'];
function snapshot(provider: TextProvider) {
  return modelSnapshotSchema.parse({ version: 1, configId: '11111111-1111-4111-8111-111111111111', configRevision: 1, provider, modelId: 'test-model', options: {}, capabilities: capabilities() });
}
function fixture(provider: TextProvider, text: string) {
  switch (provider) {
    case 'openai': return { id: 'test', object: 'chat.completion', created: 1, model: 'test-model', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] };
    case 'anthropic': return { id: 'test', type: 'message', role: 'assistant', model: 'test-model', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    case 'google': return { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } };
    case 'ollama': return { model: 'test-model', created_at: new Date(0).toISOString(), message: { role: 'assistant', content: text }, done: true, done_reason: 'stop', total_duration: 1, load_duration: 1, prompt_eval_count: 1, prompt_eval_duration: 1, eval_count: 1, eval_duration: 1 };
  }
}
describe.each(providers)('%s LangChain text adapter', provider => {
  it('maps an actual SDK request and validates the structured response without external calls', async () => {
    const requests: Request[] = [];
    const transport: typeof fetch = async input => {
      requests.push(new Request(input));
      return Response.json(fixture(provider, '{"answer":"safe"}'));
    };
    const adapter = createTextAdapter(snapshot(provider), 'fixture-secret', transport);
    expect(await adapter.generate('Return JSON.', 'Hello', z.object({ answer: z.string() }).strict(), new AbortController().signal)).toEqual({ answer: 'safe' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.redirect).toBe('manual');
    expect(requests[0]?.url).not.toContain('fixture-secret');
    if (provider !== 'ollama') expect([...requests[0]!.headers.values()].some(value => value.includes('fixture-secret'))).toBe(true);
    const body = await requests[0]!.json() as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('fixture-secret');
  });
  it('rejects schema-invalid output and does not leak provider errors or retry invisibly', async () => {
    const invalid = createTextAdapter(snapshot(provider), 'fixture-secret', async () => Response.json(fixture(provider, '{"unexpected":true}')));
    await expect(invalid.generate('JSON', 'Hello', z.object({ answer: z.string() }), new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
    let calls = 0;
    const failing = createTextAdapter(snapshot(provider), 'fixture-secret', async () => { calls++; return new Response('fixture-secret raw failure', { status: 401 }); });
    await expect(failing.generate('JSON', 'Hello', z.object({ answer: z.string() }), new AbortController().signal)).rejects.toThrow('PROVIDER_FAILURE');
    expect(calls).toBe(1);
  });
  it('propagates cancellation through the SDK transport', async () => {
    const controller = new AbortController();
    const transport: typeof fetch = async input => {
      const request = new Request(input);
      return new Promise<Response>((_done, reject) => {
        if (request.signal.aborted) { reject(new Error('aborted')); return; }
        request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        controller.abort();
      });
    };
    await expect(createTextAdapter(snapshot(provider), 'fixture-secret', transport).generate('JSON', 'Hello', z.object({}), controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('enforces the configured deadline even when the SDK omits its request signal', async () => {
    const config = snapshot(provider); config.options.timeoutMs = 1000;
    const transport: typeof fetch = async input => new Promise<Response>((_done, reject) => {
      const signal = new Request(input).signal;
      if (signal.aborted) reject(new Error('aborted'));
      else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    await expect(createTextAdapter(config, 'fixture-secret', transport).generate('JSON', 'Hello', z.object({}), new AbortController().signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
it('denies unsafe endpoints, redirects and excessive response bytes', async () => {
  for (const url of ['http://api.openai.com', 'https://evil.example', 'https://api.openai.com/path', 'https://x:secret@api.openai.com']) expect(() => providerEndpoint('openai', url)).toThrow();
  for (const url of ['http://localhost:11434', 'http://169.254.169.254', 'http://127.0.0.1/a', 'http://127.0.0.1?secret=x']) expect(() => providerEndpoint('ollama', url)).toThrow();
  const endpoint = providerEndpoint('openai');
  await expect(guardedFetch(endpoint, async () => new Response('', { status: 302, headers: { location: 'https://evil.example' } }))('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'INVALID_ENDPOINT' });
  await expect(guardedFetch(endpoint, async () => new Response('12345'), 4)('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
});
