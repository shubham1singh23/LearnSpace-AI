import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { InsertionAnchor, InsertionIsolation } from '@learnspace/shared';
import type { Autosave } from '../persistence/autosave';
import { insertText, previewInsertion } from './insert-text';

export interface InsertionSource { text: string; source: Omit<InsertionIsolation, 'sourceHash'>; label: string }
export function InsertionPreview({ request, editor, queue, canStart, freeze, onClose }: { request: InsertionSource; editor?: Editor; queue: Autosave; canStart: boolean; freeze: (value: boolean) => void; onClose: () => void }) {
  const [anchor, setAnchor] = useState<InsertionAnchor>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function capture() {
    if (!editor) return; setBusy(true); setError(''); freeze(true);
    try { await queue.flush(); setAnchor(await previewInsertion(editor, queue, request.text, request.source)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Capture failed.'); setAnchor(undefined); }
    finally { freeze(false); setBusy(false); }
  }
  async function accept() {
    if (!editor || !anchor || !window.confirm('Insert this plain text at the captured cursor and save immediately?')) return;
    setBusy(true); setError(''); freeze(true);
    try { await insertText(editor, queue, anchor, request.text); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Insertion failed.'); }
    finally { if (!queue.isolatedPending) freeze(false); setBusy(false); }
  }
  return <section aria-label="Plain text insertion preview"><h3>Insert into notes</h3><p>{request.label}</p><p>Place a collapsed cursor in an editable paragraph or heading, then preview. This inserts literal plain text and line breaks; it does not replace selected text or interpret markup. Moving the cursor after preview does not change the captured location.</p><pre style={{ whiteSpace: 'pre-wrap' }}>{request.text}</pre>{error && <p role="alert">{error}</p>}
    <button disabled={!canStart || busy} onClick={() => void capture()}>Preview at current cursor</button>
    {anchor && <><p>Captured block {anchor.blockId}, offset {anchor.offset}, revision {anchor.baseRevision}. Any document edit invalidates this preview.</p><button disabled={!canStart || busy} onClick={() => void accept()}>Confirm plain text insertion</button></>}
    <button disabled={busy || queue.isolatedPending} onClick={onClose}>Reject insertion</button>
  </section>;
}
