import { useState } from 'react';
import { courseSchema, preferencesSchema, type Course, type Preferences } from '@learnspace/shared';
import { api, envelope } from '../api';
export function CoursePreferences({ course, treeRevision, onSaved }: { course: Course; treeRevision: number; onSaved: () => void }) {
  const [preferences, setPreferences] = useState(course.preferences); const [base, setBase] = useState(treeRevision); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  return <form aria-label="Course teaching preferences" onSubmit={event => { event.preventDefault(); setBusy(true); setMessage(''); void api(`/courses/${course.id}`, envelope(courseSchema), 'PATCH', { baseTreeRevision: base, preferences: preferencesSchema.parse(preferences) }).then(result => { setBase(result.data.treeRevision); setMessage('Course preferences saved. Notes were not regenerated.'); onSaved(); }).catch(() => setMessage('Preferences were not acknowledged. Draft retained; reload metadata before explicitly retrying.')).finally(() => setBusy(false)); }}>
    <h3>This course's teaching preferences</h3><p>Workspace defaults affect new courses only. These preferences affect future context and reading; saved prose stays unchanged.</p>
    <label>Course depth<select value={preferences.depth} onChange={event => setPreferences({ ...preferences, depth: event.target.value as Preferences['depth'] })}>{['introductory', 'intermediate', 'deep'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Course style<select value={preferences.style} onChange={event => setPreferences({ ...preferences, style: event.target.value as Preferences['style'] })}>{['first_principles', 'step_by_step'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label>Course pace<select value={preferences.pace} onChange={event => setPreferences({ ...preferences, pace: event.target.value as Preferences['pace'] })}>{['self_paced', 'guided'].map(value => <option key={value}>{value}</option>)}</select></label>
    {(['examples', 'analogies', 'reflectionPauses'] as const).map(key => <label key={key}><input type="checkbox" checked={preferences[key]} onChange={event => setPreferences({ ...preferences, [key]: event.target.checked })} />{key}</label>)}
    <label>Course background<textarea maxLength={4000} value={preferences.background} onChange={event => setPreferences({ ...preferences, background: event.target.value })} /></label>
    <button disabled={busy}>Save course preferences</button><button type="button" disabled={busy} onClick={() => { void api(`/courses/${course.id}`, envelope(courseSchema)).then(result => { setBase(result.data.treeRevision); setMessage('Metadata revision refreshed. Your preference draft is retained; review before saving.'); onSaved(); }).catch(() => setMessage('Metadata reload failed.')); }}>Reload preference base revision</button>{message && <p role="status">{message}</p>}
  </form>;
}
