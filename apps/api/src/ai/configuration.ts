import { z } from 'zod';
import { capabilities, createTextAdapter, providerEndpoint, type TextAdapter } from '@learnspace/ai';
import { defaultPreferences, modelSnapshotSchema, providerDTOSchema, providerInputSchema, settingsPatchSchema, settingsSchema, textProviderSchema, type ModelSnapshot, type ProviderInput } from '@learnspace/shared';
import type { Database } from '../db.js';
import type { Environment } from '../config.js';
import type { AiProviderConfiguration } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { transaction } from '../workspace/transactions.js';

export type AdapterFactory = (snapshot: ModelSnapshot, secret?: string) => TextAdapter;
export class SessionCredentials {
  private readonly values = new Map<string, { secret: string; expires: number; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly now = Date.now) {}
  put(id: string, revision: number, secret: string) {
    this.remove(id); const key = `${id}:${revision}`; const ttl = 8 * 60 * 60 * 1000;
    const timer = setTimeout(() => this.values.delete(key), ttl); timer.unref();
    this.values.set(key, { secret, expires: this.now() + ttl, timer });
  }
  get(id: string, revision: number) {
    const key = `${id}:${revision}`; const value = this.values.get(key);
    if (value && value.expires > this.now()) return value.secret;
    if (value) clearTimeout(value.timer); this.values.delete(key); return undefined;
  }
  remove(id: string) { for (const [key, value] of this.values) if (key.startsWith(`${id}:`)) { clearTimeout(value.timer); this.values.delete(key); } }
  clear() { for (const value of this.values.values()) clearTimeout(value.timer); this.values.clear(); }
}
export class ConfigurationService {
  readonly credentials = new SessionCredentials();
  private occupied = 0;
  constructor(readonly db: Database, private readonly env: Environment, readonly factory: AdapterFactory = createTextAdapter) {}
  reserve() {
    if (this.occupied >= 2) throw new HttpError(429, 'MODEL_CAPACITY', 'Two model requests are already active. Retry later.', true);
    this.occupied++; let released = false;
    return () => { if (!released) { released = true; this.occupied--; } };
  }
  private secret(row: AiProviderConfiguration) {
    if (row.credentialSource === 'session') return this.credentials.get(row.id, row.revision);
    if (row.credentialSource === 'environment') {
      switch (row.credentialEnvName) { case 'OPENAI_API_KEY': return this.env.OPENAI_API_KEY; case 'ANTHROPIC_API_KEY': return this.env.ANTHROPIC_API_KEY; case 'GOOGLE_API_KEY': return this.env.GOOGLE_API_KEY; }
    }
    return undefined;
  }
  dto(row: AiProviderConfiguration) {
    return providerDTOSchema.parse({ id: row.id, revision: row.revision, purpose: row.purpose, provider: row.provider, modelId: row.modelId, options: row.options, credentialSource: row.credentialSource, configured: row.credentialSource === 'none' || !!this.secret(row), capabilities: row.capabilities, updatedAt: row.updatedAt.toISOString() });
  }
  async list() { return (await this.db.aiProviderConfiguration.findMany({ where: { purpose: 'text' }, orderBy: { id: 'asc' }, take: 100 })).map(row => this.dto(row)); }
  async settings() {
    const settings = await this.db.workspaceSettings.upsert({ where: { id: 1 }, create: { id: 1, preferences: defaultPreferences }, update: {} });
    return settingsSchema.parse({ preferences: settings.preferences, textConfigId: settings.textConfigId, imageConfigId: settings.imageConfigId });
  }
  async patchSettings(raw: unknown) {
    const input = settingsPatchSchema.parse(raw); await this.settings();
    const settings = await transaction(this.db, async tx => {
      if (input.textConfigId && !await tx.aiProviderConfiguration.findFirst({ where: { id: input.textConfigId, purpose: 'text' } })) throw new HttpError(422, 'INVALID_CONFIGURATION', 'Choose an existing text configuration.');
      return tx.workspaceSettings.update({ where: { id: 1 }, data: input });
    });
    return settingsSchema.parse({ preferences: settings.preferences, textConfigId: settings.textConfigId, imageConfigId: settings.imageConfigId });
  }
  private validate(input: ProviderInput) {
    try { providerEndpoint(input.provider, input.options.baseUrl); } catch { throw new HttpError(422, 'INVALID_ENDPOINT', 'Use the fixed hosted endpoint or a loopback IP Ollama origin.'); }
    const envNames = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY', ollama: null };
    if (input.provider === 'ollama' ? input.credential.source !== 'none' : input.credential.source === 'none') throw new HttpError(422, 'INVALID_CREDENTIAL_SOURCE', 'Hosted providers require a credential; local Ollama uses none.');
    if (input.credential.source === 'environment' && input.credential.envName !== envNames[input.provider]) throw new HttpError(422, 'INVALID_CREDENTIAL_SOURCE', 'Credential environment name does not match the provider.');
  }
  async write(raw: unknown, id?: string, baseRevision?: number) {
    const input = providerInputSchema.parse(raw); this.validate(input);
    const data = { purpose: input.purpose, provider: input.provider, modelId: input.modelId, options: input.options, credentialSource: input.credential.source, credentialEnvName: input.credential.source === 'environment' ? input.credential.envName : null, capabilities: capabilities(input.provider, input.modelId), registryVersion: 'text-v1' };
    const row = await transaction(this.db, async tx => {
      if (!id) return tx.aiProviderConfiguration.create({ data });
      const changed = await tx.aiProviderConfiguration.updateMany({ where: { id, purpose: 'text', revision: baseRevision }, data: { ...data, revision: { increment: 1 } } });
      if (!changed.count) throw new HttpError(409, 'CONFIGURATION_CONFLICT', 'Configuration changed. Reload before saving.');
      return tx.aiProviderConfiguration.findUniqueOrThrow({ where: { id } });
    });
    this.credentials.remove(row.id);
    if (input.credential.source === 'session') this.credentials.put(row.id, row.revision, input.credential.secret);
    return this.dto(row);
  }
  async remove(id: string) { await this.db.aiProviderConfiguration.deleteMany({ where: { id, purpose: 'text' } }); this.credentials.remove(id); }
  async resolve(id?: string, probe = false) {
    const configId = id ?? (await this.settings()).textConfigId;
    const row = configId ? await this.db.aiProviderConfiguration.findFirst({ where: { id: configId, purpose: 'text' } }) : null;
    if (!row) throw new HttpError(409, 'MODEL_NOT_CONFIGURED', 'Choose a text model in settings.');
    const secret = this.secret(row);
    if (row.credentialSource !== 'none' && !secret) throw new HttpError(409, 'CREDENTIAL_REQUIRED', 'Supply the session credential again or configure its environment variable.');
    const snapshot = modelSnapshotSchema.parse({ version: 1, configId: row.id, configRevision: row.revision, provider: row.provider, modelId: row.modelId, options: row.options, capabilities: row.capabilities });
    const invocation = probe ? { ...snapshot, options: { ...snapshot.options, maxOutputTokens: 64, timeoutMs: Math.min(15000, snapshot.options.timeoutMs) } } : snapshot;
    return { snapshot, adapter: this.factory(invocation, secret) };
  }
  async test(id: string, structured: boolean) {
    const release = this.reserve(); const started = Date.now();
    try {
      const { adapter, snapshot } = await this.resolve(id, true);
      await adapter.generate('Return only JSON: {"ok":true}. No additional fields.', structured ? 'Validate structured output.' : 'Connection test.', z.object({ ok: z.literal(true) }).strict(), AbortSignal.timeout(Math.min(15000, snapshot.options.timeoutMs)));
      return { ok: true, latencyMs: Date.now() - started, capabilities: snapshot.capabilities, warnings: ['This verifies a small text response, not factual accuracy or every model capability.'] };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return { ok: false, latencyMs: Date.now() - started, capabilities: capabilities(), warnings: ['The bounded connection test failed. Check credentials, model and endpoint.'] };
    } finally { release(); }
  }
  async initialize() {
    const settings = await this.settings();
    if (settings.textConfigId || !this.env.LEARNSPACE_TEXT_PROVIDER || !this.env.LEARNSPACE_TEXT_MODEL) return;
    const provider = textProviderSchema.parse(this.env.LEARNSPACE_TEXT_PROVIDER);
    const names = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY' };
    const input = { purpose: 'text', provider, modelId: this.env.LEARNSPACE_TEXT_MODEL, options: provider === 'ollama' ? { baseUrl: this.env.OLLAMA_BASE_URL } : {}, credential: provider === 'ollama' ? { source: 'none' } : { source: 'environment', envName: names[provider] } };
    const config = await this.write(input); await this.patchSettings({ textConfigId: config.id });
  }
}
