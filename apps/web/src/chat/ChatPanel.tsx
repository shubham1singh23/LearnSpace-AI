import { useCallback, useEffect, useRef, useState } from 'react';
import { chatPageSchema, chatStartJournalSchema, chatStartSchema, operationDTOSchema, startOperationResponseSchema, type ChatMessage, type ChatPage, type ChatStartJournal, type OperationDTO } from '@learnspace/shared';
import { api, envelope, ApiError } from '../api';
import { OperationStatus } from '../OperationStatus';
import type { IndexedDBRecovery } from '../persistence/recovery';

export interface ChatCapture { lessonId: string; baseRevision: number; selectedBlockIds?: string[] }
export function ChatPanel({ lessonId, revision, store, prepare, onDirty, canSend = false, onInsert }: { lessonId: string; revision: number; store: IndexedDBRecovery; prepare: () => Promise<ChatCapture>; onDirty: (dirty: boolean) => void; canSend?: boolean; onInsert?: (message: ChatMessage) => void }) {
  const [page, setPage] = useState<ChatPage>(); const [text, setText] = useState(''); const [error, setError] = useState('');
  const [journal, setJournal] = useState<ChatStartJournal>(); const [checked, setChecked] = useState(false); const [busy, setBusy] = useState(false);
  const [operationId, setOperationId] = useState<string>(); const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true); const reading = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirty(!checked || !!text || !!journal || busy); return () => onDirty(false); }, [onDirty, checked, text, journal, busy]);
  useEffect(() => {
    let active = true;
    void Promise.all([store.getChatStart(lessonId), api(`/lessons/${lessonId}/messages`, envelope(chatPageSchema))]).then(([saved, result]) => { if (active) { setJournal(saved); setPage(result.data); setOperationId(result.data.activeOperationId ?? undefined); setChecked(true); } }).catch(() => { if (active) setError('History or start recovery could not be read. Retry before sending.'); });
    return () => { active = false; };
  }, [lessonId, store, attempt]);
  const changed = useCallback((operation: OperationDTO) => {
    if (['pending', 'running'].includes(operation.status) || reading.current) return;
    reading.current = true;
    void api(`/lessons/${lessonId}/messages`, envelope(chatPageSchema)).then(result => { if (mounted.current) setPage(result.data); }).catch(() => { if (mounted.current) setError('Answer status is durable; reload history to retrieve it.'); }).finally(() => { reading.current = false; });
  }, [lessonId]);
  async function dispatch(saved: ChatStartJournal) {
    // Mandatory IDB commit precedes every first dispatch; replay retains exact body/key.
    await store.putChatStart(saved); if (mounted.current) setJournal(saved);
    try {
      const result = await api(`/lessons/${lessonId}/chat-turns`, envelope(startOperationResponseSchema), 'POST', saved.body, { 'Idempotency-Key': saved.idempotencyKey });
      await store.removeChatStart(lessonId);
      if (mounted.current) { setJournal(undefined); setText(''); setOperationId(result.data.operationId); const transcript = await api(`/lessons/${lessonId}/messages`, envelope(chatPageSchema)); if (mounted.current) setPage(transcript.data); }
    } catch (error) {
      if (error instanceof ApiError && !error.retryable && error.status < 500) {
        await store.removeChatStart(lessonId); if (mounted.current) setJournal(undefined);
      }
      throw error;
    }
  }
  async function send() {
    setBusy(true); setError('');
    try {
      if (journal) await dispatch(journal);
      else { const capture = await prepare(); if (capture.lessonId !== lessonId) throw new Error('Lesson changed.'); const body = chatStartSchema.parse({ baseRevision: capture.baseRevision, selectedBlockIds: capture.selectedBlockIds, message: text, clientTurnId: crypto.randomUUID() }); await dispatch(chatStartJournalSchema.parse({ version: 1, lessonId, idempotencyKey: crypto.randomUUID(), body, createdAt: new Date().toISOString() })); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Send failed.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function retry(message: ChatMessage) {
    setBusy(true); setError('');
    try {
      const capture = await prepare(); if (capture.baseRevision !== message.contextRevision) throw new Error('Notes changed. Send a new question.');
      const operation = (await api(`/operations/${message.operationId}`, envelope(operationDTOSchema))).data;
      const body = chatStartSchema.parse({ baseRevision: message.contextRevision, message: message.content, clientTurnId: message.turnId, selectedBlockIds: operation.context.chat?.selectedBlockIds, retryOfOperationId: message.operationId });
      await dispatch({ version: 1, lessonId, idempotencyKey: crypto.randomUUID(), body, createdAt: new Date().toISOString() });
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Retry failed.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <details><summary>Lesson chat</summary><section aria-label="Lesson chat"><p>Status updates use SSE with polling fallback. Complete answers appear when saved; tokens do not stream.</p>
    {error && <p role="alert">{error}</p>}<button onClick={() => setAttempt(value => value + 1)}>Reload chat history</button>
    {!page && <p>Loading history…</p>}{page && !page.messages.length && <p>No conversation yet. Chat stays separate from notes.</p>}
    {page?.page.olderCursor && <button onClick={() => { void api(`/lessons/${lessonId}/messages?before=${page.messages[0]!.id}`, envelope(chatPageSchema)).then(result => { if (mounted.current) setPage(result.data); }).catch(() => setError('Older messages could not be loaded.')); }}>Older messages</button>}
    <ol>{page?.messages.map(message => <li key={message.id}><strong>{message.role} · {message.status}</strong><p>Saved context revision {message.contextRevision}{message.contextRevision !== revision ? ' · older context' : ''}</p><pre style={{ whiteSpace: 'pre-wrap' }}>{message.content}</pre>{message.role === 'user' && ['failed', 'interrupted', 'cancelled'].includes(message.status) && message.operationId && <button disabled={!canSend || busy || !!journal || !!text} onClick={() => void retry(message)}>Retry this turn</button>}{message.role === 'assistant' && onInsert && <button onClick={() => onInsert(message)}>Insert answer into notes</button>}{message.role === 'assistant' && <button onClick={() => { void navigator.clipboard.writeText(message.content).catch(() => setError('Clipboard unavailable. Select and copy the answer text.')); }}>Copy answer</button>}</li>)}</ol>
    {operationId && <OperationStatus key={operationId} id={operationId} onChange={changed} />}
    {journal && <p role="alert">Send outcome is unknown. Retry only the original saved request. No new question will be sent.</p>}
    <label>Question<textarea aria-label="Chat question" maxLength={16000} value={text} disabled={busy || !!journal} onChange={event => setText(event.target.value)} /></label>
    <button disabled={!canSend || !checked || busy || !journal && (!text.trim() || !!page?.activeOperationId)} onClick={() => void send()}>{journal ? 'Retry original Send' : 'Send question'}</button>
    {!!text && !journal && <button disabled={busy} onClick={() => { if (window.confirm('Discard the unsent question?')) setText(''); }}>Discard unsent question</button>}
    {journal && <button disabled={busy} onClick={() => { if (window.confirm('Discard this local start handle? Any durable turn remains in history; refresh history before asking again.')) void store.removeChatStart(lessonId).then(() => { setJournal(undefined); setText(''); setAttempt(value => value + 1); }); }}>Discard local Send handle</button>}
    {!canSend && <p>Sending is unavailable until the bounded context gate is verified.</p>}
  </section></details>;
}
