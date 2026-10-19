import { useEffect, useState } from 'react';
import { courseProgressSchema, leafProgressSchema, progressStatusSchema, type CourseProgress } from '@learnspace/shared';
import { api, envelope } from '../api';
export function ProgressControls({ courseId, topicId, treeRevision }: { courseId: string; topicId?: string; treeRevision: number }) {
  const [unknown, setUnknown] = useState(false);
  const [data, setData] = useState<CourseProgress>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; void api(`/courses/${courseId}/progress`, envelope(courseProgressSchema)).then(result => { if (active) { setData(result.data); setUnknown(false); } }).catch(() => { if (active) setError('Progress could not be read.'); }); return () => { active = false; }; }, [courseId, treeRevision, attempt]);
  const topic = data?.topics.find(item => (item.isLeaf ? item.progress.topicId : item.topicId) === topicId);
  async function change(raw: string) {
    if (!topicId) return; setBusy(true); setError('');
    try { await api(`/topics/${topicId}/progress`, envelope(leafProgressSchema), 'PATCH', { status: progressStatusSchema.parse(raw) }); }
    catch { setError('Update acknowledgement failed. Current saved progress is being reloaded; review it before making another explicit change.'); }
    finally {
      try { setData((await api(`/courses/${courseId}/progress`, envelope(courseProgressSchema))).data); setUnknown(false); }
      catch { setUnknown(true); setError('Progress outcome is unknown. Reload progress successfully before another change.'); }
      finally { setBusy(false); }
    }
  }
  return <section aria-label="Learning progress"><p>{data ? `${data.completedLeaves}/${data.totalLeaves} leaves completed${data.totalLeaves ? '' : ' · empty course'}` : 'Loading progress…'}</p>{topic?.isLeaf ? <label>Leaf progress<select aria-label="Leaf progress" disabled={busy || unknown} value={topic.progress.status} onChange={event => void change(event.target.value)}>{['not_started', 'in_progress', 'completed'].map(status => <option key={status}>{status}</option>)}</select></label> : topic && <p>Container: {topic.completedLeaves}/{topic.totalLeaves} completed · derived from leaves</p>}{error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => { setAttempt(value => value + 1); }}>Reload progress</button><p>Completion is explicit. Reading, chat and generation never mark a leaf complete.</p></section>;
}
