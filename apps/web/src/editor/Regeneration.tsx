import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { operationDTOSchema, operationListSchema, receiptSchema, startOperationResponseSchema, type Lesson, type OperationDTO } from '@learnspace/shared';
import { api, envelope, ApiError } from '../api';
import { OperationStatus } from '../OperationStatus';
import type { Autosave } from '../persistence/autosave';
import { NotesEditor } from './NotesEditor';

interface Props { lesson: Lesson; courseId: string; queue: Autosave; editor?: Editor; canStart: boolean; freeze: (value: boolean) => void; onPending: (value: boolean) => void }
export function Regeneration({ lesson, courseId, queue, editor, canStart, freeze, onPending }: Props) {
  const [instruction, setInstruction] = useState(''); const [operation, setOperation] = useState<OperationDTO>(); const [id, setId] = useState<string>();
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [invalidated, setInvalidated] = useState(false); const [pending, setPending] = useState(false);
  const [capturedSequence, setCapturedSequence] = useState<number>();
  const captured = useRef<{ revision: number; sequence: number; editor: Editor } | undefined>(undefined);
  const startAttempt = useRef<{ key: string; body: { baseRevision: number; instruction?: string } } | undefined>(undefined);
  const commitAttempt = useRef<{ operationId: string; baseRevision: number; mutationId: string; confirmReplace: true } | undefined>(undefined);
  const changed = useCallback((value: OperationDTO) => setOperation(value), []);
  useEffect(() => {
    if (!editor) return;
    const update = ({ transaction }: { transaction: { docChanged: boolean } }) => { if (transaction.docChanged && captured.current) setInvalidated(true); };
    editor.on('transaction', update); return () => { editor.off('transaction', update); };
  }, [editor]);
  function stale() { const value = captured.current; return !value || value.editor !== editor || value.sequence !== queue.localSequence || value.revision !== queue.currentRevision || queue.dirty; }
  async function start() {
    if (busy || !editor || !canStart) return; setBusy(true); setMessage(''); freeze(true);
    try {
      if (!startAttempt.current) {
        await queue.flush(); captured.current = { revision: queue.currentRevision, sequence: queue.localSequence, editor }; setCapturedSequence(queue.localSequence); setInvalidated(false);
        startAttempt.current = { key: crypto.randomUUID(), body: { baseRevision: queue.currentRevision, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) } };
      }
      const request = startAttempt.current; const result = await api(`/lessons/${lesson.id}/regenerations`, envelope(startOperationResponseSchema), 'POST', request.body, { 'Idempotency-Key': request.key });
      setId(result.data.operationId); setOperation(undefined); startAttempt.current = undefined;
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Generation start was not acknowledged; retry preserves the same request.'); }
    finally { freeze(false); setBusy(false); }
  }
  async function recover() {
    if (!editor || busy || !canStart) return; setBusy(true); setMessage('');
    try {
      if (queue.localSequence !== 0 || queue.dirty) throw new Error('Recovery acceptance requires an unchanged freshly loaded lesson. Save your edits and generate a new proposal.');
      const requested = new URLSearchParams(window.location.search).get('operation');
      const list = requested ? undefined : await api(`/courses/${courseId}/operations?limit=100`, envelope(operationListSchema));
      const found = requested ? (await api(`/operations/${requested}`, envelope(operationDTOSchema))).data : list?.data.operations.filter(value => value.lessonId === lesson.id && value.kind === 'regeneration' && ['running', 'ready'].includes(value.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!found || found.lessonId !== lesson.id || found.courseId !== courseId || found.kind !== 'regeneration' || !['running', 'ready'].includes(found.status) || found.baseRevision !== queue.currentRevision) throw new Error('No current regeneration proposal was found. Use course activity to find other recovery pages.');
      const value = (await api(`/operations/${found.id}`, envelope(operationDTOSchema))).data;
      captured.current = { revision: queue.currentRevision, sequence: queue.localSequence, editor }; setCapturedSequence(queue.localSequence); setInvalidated(false); setId(found.id); setOperation(value);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Recovery failed.'); } finally { setBusy(false); }
  }
  async function accept() {
    if (busy || !operation || operation.result?.type !== 'lesson') return;
    if (!commitAttempt.current && (invalidated || stale())) { setInvalidated(true); setMessage('This proposal is stale. Your notes are retained; generate a new proposal.'); return; }
    if (!commitAttempt.current && !window.confirm('Replace all saved notes with this preview? Current notes and images remain in version history.')) return;
    setBusy(true); setMessage(''); freeze(true);
    try {
      if (!commitAttempt.current) {
        if (stale()) throw new Error('The document changed before acceptance.');
        await queue.flush(); if (stale()) throw new Error('The document changed while entering the save barrier.');
        commitAttempt.current = { operationId: operation.id, baseRevision: captured.current!.revision, mutationId: crypto.randomUUID(), confirmReplace: true };
        onPending(true); setPending(true);
      }
      const receipt = await api(`/lessons/${lesson.id}/regeneration-commits`, envelope(receiptSchema), 'POST', commitAttempt.current);
      if (receipt.data.id !== lesson.id || receipt.data.mutationId !== commitAttempt.current.mutationId) throw new Error('Regeneration acknowledgement mismatch.');
      await queue.discard(); commitAttempt.current = undefined; onPending(false); setPending(false); window.location.reload();
    } catch (error) {
      if (error instanceof ApiError && !error.retryable || !commitAttempt.current) { commitAttempt.current = undefined; onPending(false); setPending(false); freeze(false); }
      setMessage(error instanceof Error ? error.message : 'Acknowledgement is pending. Retry sends the identical mutation.');
    } finally { setBusy(false); }
  }
  const locallyStale = invalidated || capturedSequence !== undefined && capturedSequence !== queue.localSequence;
  return <section aria-label="Lesson regeneration"><details><summary>Regenerate lesson</summary><p>Generation creates a preview. Editing while it runs invalidates acceptance, including edits later undone.</p><label>Regeneration instructions<textarea maxLength={4000} value={instruction} disabled={busy || pending} onChange={event => setInstruction(event.target.value)} /></label><button disabled={busy || !canStart || pending} onClick={() => void start()}>Generate replacement preview</button><button disabled={busy || !canStart || pending} onClick={() => void recover()}>Recover regeneration proposal</button>{id && <OperationStatus key={id} id={id} onChange={changed} />}{locallyStale && <p role="alert">The document changed. This proposal cannot replace your notes.</p>}{operation?.status === 'ready' && operation.result?.type === 'lesson' && <><h3>Replacement preview</h3><NotesEditor label="Replacement preview notes" key={operation.id} document={operation.result.document} courseId={courseId} disabled onChange={() => {}} /><button disabled={busy || locallyStale || !pending && !canStart} onClick={() => void accept()}>{pending ? 'Retry pending regeneration commit' : 'Accept replacement'}</button></>}{pending && <p>Regeneration acknowledgement is pending. Editing and navigation are paused; retry uses the same mutation.</p>}{message && <p role="alert">{message}</p>}</details></section>;
}
