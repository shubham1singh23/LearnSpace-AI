import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { captureSelection, editRequestSchema, selectionRequest, startOperationResponseSchema, type EditRequest, type OperationDTO } from '@learnspace/shared';
import { api, envelope } from '../api';
import { OperationStatus } from '../OperationStatus';
import type { Autosave } from '../persistence/autosave';
import { documentSequence } from './selection-plugin';
import { validatedEditorJSON } from './extensions';
import { acceptEdit } from './accept-edit';

interface Props { lessonId: string; queue: Autosave; editor?: Editor; canStart: boolean; freeze: (value: boolean) => void }
function nativeRange(editor: Editor) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode || !editor.view.dom.contains(selection.anchorNode) || !editor.view.dom.contains(selection.focusNode)) return undefined;
  const anchor = editor.view.posAtDOM(selection.anchorNode, selection.anchorOffset); const head = editor.view.posAtDOM(selection.focusNode, selection.focusOffset);
  return { from: Math.min(anchor, head), to: Math.max(anchor, head), sequence: documentSequence(editor.state) };
}
export function SelectionEditing({ lessonId, queue, editor, canStart, freeze }: Props) {
  const [action, setAction] = useState<EditRequest['action']>('explain'); const [customMode, setCustomMode] = useState<EditRequest['mode']>('replace');
  const [retrying, setRetrying] = useState(false);
  const [instruction, setInstruction] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [operation, setOperation] = useState<OperationDTO>(); const [id, setId] = useState<string>(); const [invalidated, setInvalidated] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const captured = useRef<{ editor: Editor; instanceId: string; sequence: number; localSequence: number; revision: number } | undefined>(undefined);
  const instance = useRef<{ editor: Editor; id: string } | undefined>(undefined);
  const attempt = useRef<{ key: string; body: EditRequest } | undefined>(undefined);
  const range = useRef<{ from: number; to: number; sequence: number } | undefined>(undefined);
  const changed = useCallback((value: OperationDTO) => setOperation(value), []);
  useEffect(() => {
    if (!editor) return;
    if (instance.current?.editor !== editor) instance.current = { editor, id: crypto.randomUUID() };
    range.current = undefined;
    const selected = () => { const value = nativeRange(editor); if (value) range.current = value; };
    const update = ({ transaction }: { transaction: { docChanged: boolean } }) => { if (transaction.docChanged) { range.current = undefined; if (captured.current) setInvalidated(true); } };
    document.addEventListener('selectionchange', selected); editor.on('transaction', update);
    return () => { document.removeEventListener('selectionchange', selected); editor.off('transaction', update); };
  }, [editor]);
  function stale() {
    const value = captured.current;
    return !value || !editor || value.editor !== editor || value.instanceId !== instance.current?.id || value.sequence !== documentSequence(editor.state) || value.localSequence !== queue.localSequence || value.revision !== queue.currentRevision || queue.dirty;
  }
  async function start() {
    if (!editor || !canStart || busy) return;
    // Read native selection before moving focus into the capture barrier. The
    // browser's selectionchange event can lag a toolbar click by one event turn.
    const initialSequence = documentSequence(editor.state);
    const selection = nativeRange(editor) ?? (range.current?.sequence === initialSequence ? range.current : editor.state.selection);
    setBusy(true); setMessage(''); freeze(true);
    try {
      if (!attempt.current) {
        await queue.flush();
        const sequence = documentSequence(editor.state);
        if (sequence !== initialSequence) throw new Error('Notes changed while flushing. Select again.');
        const target = await captureSelection(validatedEditorJSON(editor.getJSON()), queue.currentRevision, selection.from, selection.to);
        if (sequence !== documentSequence(editor.state)) throw new Error('Notes changed during capture. Select again.');
        const mode = action === 'custom' ? customMode : ['explain', 'example', 'analogy'].includes(action) ? 'insert_after' : 'replace';
        const body = editRequestSchema.parse({ baseRevision: queue.currentRevision, action, mode, target: selectionRequest(target), ...(instruction.trim() ? { instruction: instruction.trim() } : {}) });
        captured.current = { editor, instanceId: instance.current!.id, sequence, localSequence: queue.localSequence, revision: queue.currentRevision };
        setInvalidated(false); attempt.current = { key: crypto.randomUUID(), body };
      }
      const value = await api(`/lessons/${lessonId}/edits`, envelope(startOperationResponseSchema), 'POST', attempt.current.body, { 'Idempotency-Key': attempt.current.key });
      setId(value.data.operationId); setOperation(undefined); attempt.current = undefined; setRetrying(false);
    } catch (error) { setRetrying(!!attempt.current); setMessage(error instanceof Error ? error.message : 'Generation was not acknowledged. Retry preserves the original request.'); }
    finally { freeze(false); setBusy(false); }
  }
  async function accept() {
    if (!editor || busy || !canStart || operation?.status !== 'ready' || operation.result?.type !== 'edit') return;
    if (invalidated || stale()) { setInvalidated(true); setMessage('This proposal is stale. Capture a new selection.'); return; }
    if (!window.confirm(operation.result.prepared.mode === 'replace' ? 'Replace only the captured selection with this proposal? The prior revision remains in history.' : 'Insert this proposal after the captured block? The prior revision remains in history.')) return;
    setBusy(true); setMessage(''); freeze(true);
    try {
      await queue.flush(); if (stale()) throw new Error('The selection became stale before acceptance.');
      await acceptEdit(editor, queue, operation.id, operation.result.prepared, captured.current!.sequence);
      setOperation({ ...operation, status: 'applied', result: { type: 'applied_lesson', lessonId, revision: queue.currentRevision } }); setRefresh(value => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Acceptance acknowledgement is pending. Retry the identical save request.'); }
    finally { if (!queue.isolatedPending) freeze(false); setBusy(false); }
  }
  const isStale = invalidated;
  return <section aria-label="AI selection editing"><h3>Edit selected notes with AI</h3><p>Select text in a paragraph or heading, or complete sibling text blocks. Cursor-only and structural edits are unsupported. Every document change makes a captured proposal stale.</p>
    <div role="toolbar" aria-label="AI selection actions" onPointerDown={event => { if (editor) { const value = nativeRange(editor); if (value) range.current = value; } if ((event.target as HTMLElement).tagName === 'BUTTON') event.preventDefault(); }} onMouseDown={event => { if ((event.target as HTMLElement).tagName === 'BUTTON') event.preventDefault(); }}>
      <label>Selection action<select value={action} disabled={busy} onChange={event => setAction(event.target.value as EditRequest['action'])}>{['explain', 'simplify', 'expand', 'rewrite', 'example', 'analogy', 'custom'].map(value => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></label>
      {action === 'custom' && <label>Custom edit mode<select value={customMode} onChange={event => setCustomMode(event.target.value as EditRequest['mode'])}><option value="replace">Replace selected text</option><option value="insert_after">Insert after selected block</option></select></label>}
      <label>Selection instructions<textarea maxLength={4000} value={instruction} disabled={busy} onChange={event => setInstruction(event.target.value)} /></label>
      <button disabled={!canStart || !editor || busy} onClick={() => void start()}>{retrying ? 'Retry selection generation' : 'Generate selection proposal'}</button>
    </div>
    {id && <OperationStatus key={`${id}:${refresh}`} id={id} onChange={changed} originalEdit />}
    {isStale && <p role="alert">This selection proposal is stale. Generate a new proposal from saved notes.</p>}
    {operation?.status === 'ready' && operation.result?.type === 'edit' && <button disabled={busy || isStale || !canStart || queue.isolatedPending} onClick={() => void accept()}>Accept selection edit</button>}
    {message && <p role="alert">{message}</p>}
  </section>;
}
