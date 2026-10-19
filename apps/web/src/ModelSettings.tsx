import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { connectionResultSchema, defaultPreferences, providerDTOSchema, settingsSchema, type Preferences, type ProviderDTO, type TextProvider } from '@learnspace/shared';
import { api, envelope } from './api';

export function ModelSettings({ onPreferences }: { onPreferences: (preferences: Preferences) => void }) {
  const [configs, setConfigs] = useState<ProviderDTO[]>([]); const [selected, setSelected] = useState('');
  const [provider, setProvider] = useState<TextProvider>('openai'); const [model, setModel] = useState('');
  const [source, setSource] = useState<'session' | 'environment'>('session'); const secret = useRef<HTMLInputElement>(null);
  const [preferences, setPreferences] = useState(defaultPreferences); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const credentialInput = secret.current;
    void Promise.all([api('/provider-configurations', envelope(z.array(providerDTOSchema))), api('/settings', envelope(settingsSchema))]).then(([configs, settings]) => {
      if (!active) return; setConfigs(configs.data); setSelected(settings.data.textConfigId ?? ''); setPreferences(settings.data.preferences); onPreferences(settings.data.preferences);
    }).catch(() => { if (active) setMessage('Model settings could not be loaded. Retry.'); });
    return () => { active = false; if (credentialInput) credentialInput.value = ''; };
  }, [attempt, onPreferences]);
  async function action(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Settings request failed.'); } finally { setBusy(false); } }
  return <details><summary>Text model settings</summary><p>Manual notes work without a model. Connection tests make a small provider request and may incur a charge. Session keys expire after eight hours or server restart.</p>
    <label>Default text configuration<select value={selected} disabled={busy} onChange={event => { const id = event.target.value; void action(async () => { await api('/settings', envelope(settingsSchema), 'PATCH', { textConfigId: id || null }); setSelected(id); }); }}><option value="">None</option>{configs.map(config => <option key={config.id} value={config.id}>{config.provider}: {config.modelId} ({config.configured ? 'configured' : 'credential required'})</option>)}</select></label>
    {configs.map(config => <div key={config.id}><span>{config.provider} / {config.modelId}</span><button disabled={busy} onClick={() => void action(async () => { const result = await api(`/provider-configurations/${config.id}/test`, envelope(connectionResultSchema), 'POST', { capability: 'structured' }); setMessage(result.data.ok ? `Connection test passed. ${result.data.warnings.join(' ')}` : result.data.warnings.join(' ')); })}>Test {config.modelId}</button><button disabled={busy} onClick={() => void action(async () => { await api(`/provider-configurations/${config.id}`, z.undefined(), 'DELETE', {}); setAttempt(value => value + 1); })}>Delete {config.modelId}</button></div>)}
    <form onSubmit={event => { event.preventDefault(); const credential = provider === 'ollama' ? { source: 'none' } : source === 'environment' ? { source, envName: { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY' }[provider] } : { source, secret: secret.current?.value ?? '' }; if (secret.current) secret.current.value = ''; void action(async () => {
      const saved = await api('/provider-configurations', envelope(providerDTOSchema), 'POST', { purpose: 'text', provider, modelId: model, options: {}, credential });
      await api('/settings', envelope(settingsSchema), 'PATCH', { textConfigId: saved.data.id }); setAttempt(value => value + 1); setMessage('Configuration saved.');
    }); }}>
      <label>Provider<select value={provider} onChange={event => { setProvider(event.target.value as TextProvider); if (secret.current) secret.current.value = ''; }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="google">Google Gemini</option><option value="ollama">Ollama</option></select></label>
      <label>Model ID<input required maxLength={160} value={model} onChange={event => setModel(event.target.value)} /></label>
      {provider !== 'ollama' && <><label>Credential source<select value={source} onChange={event => { setSource(event.target.value as 'session' | 'environment'); if (secret.current) secret.current.value = ''; }}><option value="session">Session only</option><option value="environment">Server environment</option></select></label>{source === 'session' && <label>Session API key<input ref={secret} type="password" autoComplete="off" required maxLength={4096} /></label>}</>}
      <button disabled={busy}>Save text configuration</button>
    </form>
    <form onSubmit={event => { event.preventDefault(); void action(async () => { await api('/settings', envelope(settingsSchema), 'PATCH', { preferences }); onPreferences(preferences); setMessage('Defaults saved for new courses.'); }); }}>
      <h3>New course defaults</h3><label>Depth<select value={preferences.depth} onChange={event => setPreferences({ ...preferences, depth: event.target.value as Preferences['depth'] })}>{['introductory', 'intermediate', 'deep'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Style<select value={preferences.style} onChange={event => setPreferences({ ...preferences, style: event.target.value as Preferences['style'] })}>{['first_principles', 'step_by_step'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Pace<select value={preferences.pace} onChange={event => setPreferences({ ...preferences, pace: event.target.value as Preferences['pace'] })}>{['self_paced', 'guided'].map(value => <option key={value}>{value}</option>)}</select></label>
      {(['examples', 'analogies', 'reflectionPauses'] as const).map(key => <label key={key}><input type="checkbox" checked={preferences[key]} onChange={event => setPreferences({ ...preferences, [key]: event.target.checked })} />{key}</label>)}
      <label>Background<textarea maxLength={4000} value={preferences.background} onChange={event => setPreferences({ ...preferences, background: event.target.value })} /></label><button disabled={busy}>Save course defaults</button>
    </form>{message && <p role="status">{message}</p>}{busy && <p role="status">Working…</p>}
  </details>;
}
