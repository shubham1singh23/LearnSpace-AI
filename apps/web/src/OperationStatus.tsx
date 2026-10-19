import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { operationDTOSchema, operationEventSchema, operationListSchema, type OperationDTO } from '@learnspace/shared';
import { api, envelope } from './api';
import { SyllabusReview } from './Syllabus';
import { EditPreview } from './editor/EditPreview';

export function OperationStatus({ id, onChange, originalEdit = false }: { id: string; onChange?: (operation: OperationDTO) => void; originalEdit?: boolean }) {
  const [operation, setOperation] = useState<OperationDTO>(); const [message, setMessage] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; let pending = false; let terminal = false; let last = '';
    const publish = (value: OperationDTO) => { if (!active) return; const next = JSON.stringify(value); if (next === last) return; last = next; terminal = !['pending', 'running'].includes(value.status); setOperation(value); onChange?.(value); };
    const load = async () => { if (pending || terminal) return; pending = true; try { publish((await api(`/operations/${id}`, envelope(operationDTOSchema))).data); } catch { if (active) setMessage('Progress unavailable. Retrying the saved operation; no new generation was started.'); } finally { pending = false; } };
    const source = new EventSource(`/api/v1/operations/${id}/events`);
    const event = (event: MessageEvent<string>) => { try { publish(operationEventSchema.parse(JSON.parse(event.data)).operation); } catch { void load(); } };
    for (const type of ['status', 'ready', 'done', 'error', 'cancelled']) source.addEventListener(type, event as EventListener);
    source.onerror = () => { source.close(); if (active && !terminal) setMessage('Live progress disconnected. Using durable polling.'); void load(); };
    void load(); const polling = setInterval(() => { void load(); }, 1500);
    return () => { active = false; clearInterval(polling); source.close(); };
  }, [id, attempt, onChange]);
  async function cancel(reject: boolean) {
    try { const result = await api(`/operations/${id}/${reject ? 'rejections' : 'cancel'}`, envelope(operationDTOSchema), 'POST', {}); setOperation(result.data); onChange?.(result.data); setAttempt(value => value + 1); }
    catch { setMessage('The operation action failed. Reload its durable status before retrying.'); }
  }
  return <section aria-label={`Operation ${id}`}><p role="status">{operation ? `${operation.kind}: ${operation.status}` : 'Loading operation…'}</p>{operation && <p>Model: {operation.model.provider} / {operation.model.modelId}{operation.baseRevision !== null ? ` ? captured revision ${operation.baseRevision}` : ''}</p>}{operation?.context.omitted && <p>Some context was omitted to fit model limits.</p>}{operation?.errorCode && <p>{operation.errorCode}</p>}{message && <p>{message}</p>}<button onClick={() => setAttempt(value => value + 1)}>Reload operation status</button>{operation && ['pending', 'running'].includes(operation.status) && <button onClick={() => void cancel(false)}>Cancel generation</button>}{operation?.status === 'ready' && <button onClick={() => void cancel(true)}>Reject proposal</button>}{operation?.status === 'ready' && operation.kind === 'regeneration' && operation.topicId && <Link to={`/courses/${operation.courseId}/topics/${operation.topicId}?operation=${operation.id}`}>Open lesson to recover preview</Link>}{operation?.status === 'applied' && operation.kind !== 'edit' && operation.result?.type === 'applied_lesson' && <button onClick={() => window.location.reload()}>Load generated notes</button>}{operation?.status === 'ready' && operation.result?.type === 'edit' && <><EditPreview prepared={operation.result.prepared} />{!originalEdit && <p>Recovered proposals are view/copy/reject only. Acceptance requires the original editor capture.</p>}</>}{operation?.status === 'ready' && operation.result?.type === 'syllabus' && operation.baseTreeRevision !== null && <SyllabusReview key={operation.id} operationId={operation.id} courseId={operation.courseId} baseTreeRevision={operation.baseTreeRevision} draft={operation.result.draft} />}</section>;
}
export function CourseOperations({ courseId, startedId }: { courseId: string; startedId?: string }) {
  const [ids, setIds] = useState<string[]>([]); const [message, setMessage] = useState(''); const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  async function older() {
    if (!cursor) return;
    try { const result = await api(`/courses/${courseId}/operations?limit=100&cursor=${cursor}`, envelope(operationListSchema)); setIds(current => [...new Set([...current, ...result.data.operations.filter(operation => ['pending', 'running', 'ready', 'failed', 'interrupted'].includes(operation.status)).map(operation => operation.id)])]); setCursor(result.data.page.nextCursor); }
    catch { setMessage('The next recovery page could not be loaded. Retry.'); }
  }
  useEffect(() => { let active = true; void api(`/courses/${courseId}/operations?limit=100`, envelope(operationListSchema)).then(result => { if (active) { setCursor(result.data.page.nextCursor); setIds(result.data.operations.filter(operation => ['pending', 'running', 'ready', 'failed', 'interrupted'].includes(operation.status)).map(operation => operation.id)); } }).catch(() => { if (active) setMessage('Saved operations could not be loaded.'); }); return () => { active = false; }; }, [courseId, attempt]);
  const visible = [...new Set([...(startedId ? [startedId] : []), ...ids])];
  return <details open={!!startedId}><summary>Course generation activity</summary><button onClick={() => setAttempt(value => value + 1)}>Recover saved operations</button>{message && <p role="alert">{message}</p>}{!visible.length && <p>No recoverable operations in this page.</p>}{visible.map(id => <OperationStatus key={id} id={id} />)}{cursor && <button onClick={() => void older()}>More operation recovery results</button>}</details>;
}
