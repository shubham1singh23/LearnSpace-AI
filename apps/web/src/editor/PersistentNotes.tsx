import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { lessonSchema, receiptSchema, versionsSchema, versionSchema, type Lesson } from '@learnspace/shared';
import type { z } from 'zod';
import { api, envelope, ApiError } from '../api';
import { Autosave, type SaveStatus } from '../persistence/autosave';
import { IndexedDBRecovery, type RecoveryDraft } from '../persistence/recovery';
import { NotesEditor } from './NotesEditor';

export interface NotesHandle { flush(): Promise<void>; dirty(): boolean; download(): void; freeze(value: boolean): void }
interface Props { lesson: Lesson; courseId: string; onHandle: (handle: NotesHandle | undefined) => void }
function recoveryScope() {
  try {
    const prior = sessionStorage.getItem('learnspace-recovery-tab');
    if (prior) return prior;
    const id = crypto.randomUUID(); sessionStorage.setItem('learnspace-recovery-tab', id); return id;
  } catch { return crypto.randomUUID(); }
}
const store = new IndexedDBRecovery(recoveryScope());
export function downloadJSON(document: unknown, name = 'learnspace-recovery.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
  const anchor = documentOwner().createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function documentOwner() { return window.document; }
export function PersistentNotes({ lesson, courseId, onHandle }: Props) {
  const [status, setStatus] = useState<SaveStatus>({ state: 'saved', revision: lesson.revision, dirty: false, message: '', recoveryWarning: '' });
  const [queue] = useState(() => new Autosave(lesson, store, async body => (await api(`/lessons/${lesson.id}`, envelope(receiptSchema), 'PUT', body)).data, setStatus));
  const [draft, setDraft] = useState<RecoveryDraft>(); const [checked, setChecked] = useState(false);
  const [editorDocument, setEditorDocument] = useState(lesson.document); const [epoch, setEpoch] = useState(0);
  const [remote, setRemote] = useState<Lesson>(); const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const editor = useRef<Editor | undefined>(undefined);
  const [history, setHistory] = useState<z.infer<typeof versionsSchema>>();
  const [preview, setPreview] = useState<z.infer<typeof versionSchema>>();
  const [restorePending, setRestorePending] = useState(false);
  const restoreAttempt = useRef<{ sourceRevision: number; baseRevision: number; mutationId: string; confirm: true } | undefined>(undefined);
  const freeze = (value: boolean) => { editor.current?.setEditable(!value, false); setFrozen(value); };
  useEffect(() => {
    let active = true;
    void store.get(lesson.id).then(value => { if (active) { setDraft(value); setChecked(true); } }).catch(() => { if (active) { setError('Recovery storage could not be read. Keep the tab open and download JSON if saving fails.'); setChecked(true); } });
    return () => { active = false; };
  }, [lesson.id]);
  useEffect(() => {
    onHandle({ flush: async () => { if (restoreAttempt.current) throw new Error('Resolve the pending restore acknowledgement first.'); if (invalid || draft || !checked) throw new Error('Resolve invalid content or the recovery draft first.'); await queue.flush(); }, dirty: () => queue.dirty || invalid || !!draft || !checked || !!restoreAttempt.current, download: () => downloadJSON(draft ?? (invalid ? editor.current?.getJSON() : queue.snapshot)), freeze: value => { editor.current?.setEditable(!value, false); setFrozen(value); } });
    return () => onHandle(undefined);
  }, [queue, onHandle, invalid, draft, checked]);
  useEffect(() => { queue.start(); return () => queue.stop(); }, [queue]);
  async function perform(work: () => Promise<unknown>) { try { setError(''); await work(); } catch (error) { setError(error instanceof Error ? error.message : 'Save failed.'); } }
  async function loadRemote() { const value = (await api(`/topics/${lesson.topicId}/lesson`, envelope(lessonSchema))).data; setRemote(value); return value; }
  async function loadHistory(cursor?: string) {
    const value = (await api(`/lessons/${lesson.id}/versions${cursor ? `?cursor=${cursor}` : ''}`, envelope(versionsSchema))).data;
    setHistory(previous => cursor && previous ? { ...value, versions: [...previous.versions, ...value.versions] } : value);
  }
  return <>
    <div role="status" aria-live="polite">{status.state === 'saved' ? `Saved · revision ${status.revision}` : status.state === 'saving' ? 'Saving…' : status.state === 'conflict' ? 'Conflict · local notes retained' : status.state === 'error' ? 'Save failed · local notes retained' : 'Unsaved changes'}</div>
    {status.recoveryWarning && <p role="alert">{status.recoveryWarning}</p>}{error && <p role="alert">{error}</p>}
    <div className="editor-toolbar"><button disabled={invalid || !!draft || !checked || frozen} onClick={() => void perform(() => queue.flush())}>Save notes</button><button onClick={() => downloadJSON(draft ?? (invalid ? editor.current?.getJSON() : queue.snapshot))}>Download recovery JSON</button>{(status.state === 'error' || status.state === 'conflict') && <><button onClick={() => void perform(() => queue.flush())}>Retry save</button><button onClick={() => void perform(loadRemote)}>Compare server copy</button></>}</div>
    {draft && <section className="notice" aria-label="Recovery draft"><h3>Unsaved recovery draft found</h3><p>Draft based on revision {draft.baseRevision}; server revision {lesson.revision}. Review before resuming. No automatic overwrite.</p><details><summary>Local recovery JSON</summary><pre>{JSON.stringify(draft.document, null, 2)}</pre></details><button onClick={() => { queue.recover(draft); setEditorDocument(draft.document); setEpoch(value => value + 1); setDraft(undefined); }}>Resume recovery draft</button><button onClick={() => void perform(async () => { if (window.confirm('Discard this browser draft and use saved notes? Download it first if needed.')) { await store.remove(lesson.id); setDraft(undefined); } })}>Discard recovery draft</button></section>}
    {remote && <section className="notice" aria-label="Conflict comparison"><h3>Server revision {remote.revision}</h3><details><summary>Server JSON</summary><pre>{JSON.stringify(remote.document, null, 2)}</pre></details><details><summary>Local JSON</summary><pre>{JSON.stringify(queue.snapshot, null, 2)}</pre></details><button onClick={() => void perform(async () => {
      if (!window.confirm('Replace the server notes with your local copy? The current server state will remain in version history.')) return;
      const fresh = await loadRemote(); await queue.overwriteAt(fresh.revision); setRemote(undefined);
    })}>Save local copy over server</button><button onClick={() => void perform(async () => {
      if (!window.confirm('Discard local edits and load the server copy? Download recovery JSON first if needed.')) return;
      freeze(true);
      try { const fresh = await loadRemote(); await queue.discard(); window.location.reload(); void fresh; }
      finally { freeze(false); }
    })}>Load server copy</button></section>}
    <button onClick={() => void perform(() => loadHistory())}>Version history</button>
    {history && <section aria-label="Version history"><h3>Saved versions · current revision {history.currentRevision}</h3><button onClick={() => void perform(async () => { setPreview((await api(`/lessons/${lesson.id}/versions/${history.currentRevision}`, envelope(versionSchema))).data); })}>Preview current revision</button>{history.versions.map(version => <button key={version.revision} onClick={() => void perform(async () => { setPreview((await api(`/lessons/${lesson.id}/versions/${version.revision}`, envelope(versionSchema))).data); })}>Preview revision {version.revision} · {version.source}</button>)}{history.page.nextCursor && <button onClick={() => void perform(() => loadHistory(history.page.nextCursor!))}>Older versions</button>}<button onClick={() => { setHistory(undefined); setPreview(undefined); }}>Close history</button></section>}
    {preview && <section className="notice" aria-label="Version preview"><h3>Revision {preview.revision} · {preview.source}</h3><pre>{JSON.stringify(preview.document, null, 2)}</pre><button onClick={() => downloadJSON(preview, `lesson-revision-${preview.revision}.json`)}>Download version JSON</button><button disabled={frozen && !restorePending || invalid || !!draft} onClick={() => void perform(async () => {
      if (!restoreAttempt.current && !window.confirm(`Restore revision ${preview.revision} as a new revision? Current notes will be retained in history.`)) return;
      freeze(true);
      try {
        if (!restoreAttempt.current) {
          await queue.flush();
          restoreAttempt.current = { sourceRevision: preview.revision, baseRevision: queue.currentRevision, mutationId: crypto.randomUUID(), confirm: true }; setRestorePending(true);
        }
        await api(`/lessons/${lesson.id}/restores`, envelope(receiptSchema), 'POST', restoreAttempt.current);
        restoreAttempt.current = undefined; setRestorePending(false);
        window.location.reload();
      } catch (error) {
        if (error instanceof ApiError && !error.retryable) { restoreAttempt.current = undefined; setRestorePending(false); freeze(false); }
        else if (!restoreAttempt.current) freeze(false);
        throw error;
      }
    })}>{restorePending ? 'Retry pending restore' : 'Restore this version'}</button>{restorePending && <p>Restore acknowledgement is pending. Editing is paused; retry uses the same mutation ID.</p>}</section>}
    <NotesEditor key={`${lesson.id}:${epoch}`} document={editorDocument} courseId={courseId} disabled={!checked || !!draft || frozen} onReady={value => { editor.current = value; }} onValidity={value => { setInvalid(value); if (value) queue.invalidate(); }} onChange={document => queue.edit(document)} />
  </>;
}
