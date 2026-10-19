import { capabilitiesSchema, type TextProvider } from '@learnspace/shared';
import type { z } from 'zod';
type Capabilities = z.infer<typeof capabilitiesSchema>;
const fallback: Capabilities = { structuredOutput: 'prompt_json', streaming: 'unknown', vision: 'unsupported', toolCalling: 'unknown', imageGeneration: 'unsupported', contextWindow: 16384, maxOutputTokens: 8192, registryVersion: 'text-v1', source: 'Application limits, reviewed 2026-10-19; model-specific capabilities unverified' };
const registry: Readonly<Record<TextProvider, Readonly<Capabilities>>> = {
  openai: fallback, anthropic: fallback, google: fallback, ollama: fallback
};
/** Free-form models use conservative provider defaults until an exact override is verified. */
export function capabilities(provider: TextProvider = 'openai', _modelId?: string): Capabilities {
  return capabilitiesSchema.parse(registry[provider]);
}
