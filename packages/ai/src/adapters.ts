import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogle } from '@langchain/google';
import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ModelSnapshot } from '@learnspace/shared';
import { z } from 'zod';
import { guardedFetch, ModelError, providerEndpoint } from './transport.js';

export { capabilities } from './registry.js';
export interface TextAdapter {
  generate<T>(system: string, input: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T>;
}
export function createTextAdapter(snapshot: ModelSnapshot, secret: string | undefined, transport?: typeof fetch): TextAdapter {
  const endpoint = providerEndpoint(snapshot.provider, snapshot.options.baseUrl);
  if (snapshot.provider !== 'ollama' && !secret) throw new ModelError('PROVIDER_FAILURE');
  // Never inherit environment-enabled hosted tracing or verbose prompt logging.
  for (const name of ['LANGCHAIN_TRACING', 'LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING', 'LANGSMITH_TRACING_V2', 'LANGCHAIN_VERBOSE', 'LANGSMITH_DEBUG']) delete process.env[name];
  function makeModel(signal: AbortSignal) {
  const safeFetch = guardedFetch(endpoint, transport, 1024 * 1024, signal);
  const common = { model: snapshot.modelId, temperature: snapshot.options.temperature, maxRetries: 0, callbacks: [], verbose: false, disableStreaming: true };
  let model: BaseChatModel;
  switch (snapshot.provider) {
    case 'openai': model = new ChatOpenAI({ ...common, apiKey: secret, maxTokens: snapshot.options.maxOutputTokens, configuration: { baseURL: `${endpoint.origin}/v1`, fetch: safeFetch } }); break;
    case 'anthropic': model = new ChatAnthropic({ ...common, apiKey: secret, maxTokens: snapshot.options.maxOutputTokens, clientOptions: { baseURL: endpoint.origin, fetch: safeFetch } }); break;
    case 'google': model = new ChatGoogle({ ...common, apiKey: secret, maxOutputTokens: snapshot.options.maxOutputTokens, apiClient: {
      hasApiKey: () => true, getProjectId: async () => '', fetch: async request => {
        const url = new URL(request.url); url.searchParams.delete('key');
        const headers = new Headers(request.headers); headers.set('x-goog-api-key', secret ?? '');
        return safeFetch(new Request(url, { method: request.method, headers, body: await request.arrayBuffer(), signal: request.signal }));
      }
    } }); break;
    case 'ollama': model = new ChatOllama({ ...common, baseUrl: endpoint.origin, numPredict: snapshot.options.maxOutputTokens, fetch: safeFetch }); break;
  }
  return model;
  }
  return { async generate(system, input, schema, signal) {
    const budget = Math.min(12000, snapshot.capabilities.contextWindow - snapshot.options.maxOutputTokens - 1024);
    // A byte-per-token bound is intentionally conservative across tokenizers.
    if (Buffer.byteLength(system + input, 'utf8') > budget) throw new ModelError('OUTPUT_LIMIT');
    const timeout = AbortSignal.timeout(snapshot.options.timeoutMs);
    const boundedSignal = AbortSignal.any([signal, timeout]);
    try {
      const model = makeModel(boundedSignal);
      const prompt = ChatPromptTemplate.fromMessages([['system', '{system}'], ['human', '{input}']]);
      const response = await prompt.pipe(model).invoke({ system, input }, { signal: boundedSignal, callbacks: [] });
      if (boundedSignal.aborted) throw new ModelError('CANCELLED');
      if (typeof response.content !== 'string' || response.content.length > 512000) throw new ModelError('INVALID_OUTPUT');
      let json: unknown;
      try { json = JSON.parse(response.content); } catch { throw new ModelError('INVALID_OUTPUT'); }
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw new ModelError('INVALID_OUTPUT');
      return parsed.data;
    } catch (error) {
      if (error instanceof ModelError) throw error;
      throw new ModelError(boundedSignal.aborted ? 'CANCELLED' : 'PROVIDER_FAILURE');
    }
  } };
}
