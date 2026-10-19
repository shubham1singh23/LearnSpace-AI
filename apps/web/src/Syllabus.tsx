import { useRef, useState } from 'react';
import { startOperationResponseSchema, syllabusCommitResponseSchema, syllabusDraftSchema, type SyllabusDraft } from '@learnspace/shared';
import { api, envelope } from './api';

export function SyllabusStart({ courseId, treeRevision, onStarted }: { courseId: string; treeRevision: number; onStarted: (id: string) => void }) {
  const [instruction, setInstruction] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const pending = useRef<{ key: string; body: { baseTreeRevision: number; instruction?: string } } | undefined>(undefined);
  async function start() {
    if (busy) return; setBusy(true); setMessage('');
    pending.current ??= { key: crypto.randomUUID(), body: { baseTreeRevision: treeRevision, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) } }; setRetrying(true);
    try { const request = pending.current; const result = await api(`/courses/${courseId}/syllabus-generations`, envelope(startOperationResponseSchema), 'POST', request.body, { 'Idempotency-Key': request.key }); onStarted(result.data.operationId); pending.current = undefined; setRetrying(false); setMessage('Generation started. Review the draft before adding any topics.'); }
    catch { setMessage('Start was not acknowledged. Retry sends the same request key; you can also recover course operations.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Syllabus generation"><label>Syllabus instructions<textarea maxLength={4000} value={instruction} disabled={retrying || busy} onChange={event => setInstruction(event.target.value)} /></label><button disabled={busy} onClick={() => void start()}>{retrying ? 'Retry syllabus start' : 'Generate syllabus draft'}</button>{message && <p role="status">{message}</p>}</section>;
}
export function SyllabusReview({ draft, operationId, courseId, baseTreeRevision }: { draft: SyllabusDraft; operationId: string; courseId: string; baseTreeRevision: number }) {
  const [text, setText] = useState(() => JSON.stringify(draft, null, 2));
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [retrying, setRetrying] = useState(false);
  const pending = useRef<{ operationId: string; baseTreeRevision: number; draft: SyllabusDraft } | undefined>(undefined);
  let valid = false;
  try { valid = syllabusDraftSchema.safeParse(JSON.parse(text)).success; } catch { /* Keep invalid local review edits visible. */ }
  async function commit() {
    if (busy) return; setBusy(true); setRetrying(true); setMessage('');
    try { pending.current ??= { operationId, baseTreeRevision, draft: syllabusDraftSchema.parse(JSON.parse(text)) }; await api(`/courses/${courseId}/syllabus-commits`, envelope(syllabusCommitResponseSchema), 'POST', pending.current); window.location.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Commit was not acknowledged. Retry the identical reviewed draft.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Syllabus review"><h3>Review syllabus draft</h3><p>No topics or lessons have been created. Review titles, objectives, order and prerequisites. You can edit this structured draft. Review edits remain local until committed.</p><textarea aria-label="Syllabus draft JSON" value={text} disabled={busy || retrying} onChange={event => setText(event.target.value)} rows={18} spellCheck={false} /><p role="status">{valid ? 'Draft structure is valid. Review educational accuracy before committing.' : 'Draft is invalid. Correct the JSON, references, ordering or cycles.'}</p><button disabled={!valid || busy} onClick={() => void commit()}>{retrying ? 'Retry syllabus commit' : 'Commit reviewed syllabus'}</button>{message && <p role="alert">{message}</p>}</section>;
}
