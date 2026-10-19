import type { TextProvider } from '@learnspace/shared';

export class ModelError extends Error {
  constructor(readonly code: 'INVALID_ENDPOINT' | 'PROVIDER_FAILURE' | 'OUTPUT_LIMIT' | 'INVALID_OUTPUT' | 'CANCELLED', readonly retryable = false) { super(code); }
}

const origins: Record<Exclude<TextProvider, 'ollama'>, string> = {
  openai: 'https://api.openai.com', anthropic: 'https://api.anthropic.com', google: 'https://generativelanguage.googleapis.com'
};
export function providerEndpoint(provider: TextProvider, supplied?: string): URL {
  let url: URL;
  try { url = new URL(supplied ?? (provider === 'ollama' ? 'http://127.0.0.1:11434' : origins[provider])); }
  catch { throw new ModelError('INVALID_ENDPOINT'); }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new ModelError('INVALID_ENDPOINT');
  if (provider === 'ollama') {
    // IP literals avoid DNS rebinding of a purported local endpoint.
    if (!['127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw new ModelError('INVALID_ENDPOINT');
  } else if (url.origin !== origins[provider]) throw new ModelError('INVALID_ENDPOINT');
  return url;
}

/** Every SDK request passes this boundary, including retries and redirects. */
export function guardedFetch(endpoint: URL, transport: typeof fetch = fetch, maxBytes = 1024 * 1024, signal?: AbortSignal): typeof fetch {
  return async (input, init) => {
    const original = new Request(input, init);
    const request = new Request(original, { redirect: 'manual', ...(signal ? { signal: AbortSignal.any([signal, original.signal]) } : {}) });
    const url = new URL(request.url);
    if (url.origin !== endpoint.origin || url.username || url.password) throw new ModelError('INVALID_ENDPOINT');
    if (request.method !== 'POST') throw new ModelError('INVALID_ENDPOINT');
    const body = await request.clone().arrayBuffer();
    if (body.byteLength > 256 * 1024) throw new ModelError('OUTPUT_LIMIT');
    try {
      const response = await transport(request);
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new ModelError('INVALID_ENDPOINT'); }
      if (!response.ok) { await response.body?.cancel(); throw new ModelError('PROVIDER_FAILURE', response.status === 429 || response.status >= 500); }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      if (reader) try {
        for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > maxBytes) throw new ModelError('OUTPUT_LIMIT'); chunks.push(part.value); }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const headers = new Headers(response.headers); headers.delete('content-encoding'); headers.delete('content-length');
      return new Response(bytes, { status: response.status, headers });
    } catch (error) {
      if (error instanceof ModelError) throw error;
      throw new ModelError(request.signal.aborted ? 'CANCELLED' : 'PROVIDER_FAILURE', !request.signal.aborted);
    }
  };
}
