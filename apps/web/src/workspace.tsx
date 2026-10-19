import { useCallback, useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { courseSchema, defaultPreferences, lessonSchema, treeSchema, topicMutationSchema, treeMutationSchema, prerequisiteMutationSchema, edgeMutationSchema, type Course, type Lesson, type Topic } from '@learnspace/shared';
import { api, envelope, ApiError } from './api';
import { PersistentNotes, type NotesHandle } from './editor/PersistentNotes';
import { blankDocument } from './editor/extensions';
import { leaveAfterSave } from './persistence/navigation';
import { ModelSettings } from './ModelSettings';
import { CourseOperations } from './OperationStatus';
import { SyllabusStart } from './Syllabus';
import { InitialGeneration } from './InitialGeneration';
import { CoursePreferences } from './learning/CoursePreferences';
import { ProgressControls } from './learning/ProgressControls';

type Tree = z.infer<typeof treeSchema>;
export function Workspace() {
  const navigate = useNavigate(); const location = useLocation();
  const match = /^\/courses\/([a-f0-9-]+)(?:\/topics\/([a-f0-9-]+))?$/.exec(location.pathname);
  const courseId = match?.[1]; const topicId = match?.[2];
  const [courses, setCourses] = useState<Course[]>([]); const [tree, setTree] = useState<Tree>();
  const [coursePreferences, setCoursePreferences] = useState(defaultPreferences);
  const [startedOperation, setStartedOperation] = useState<{ courseId: string; id: string }>();
  const [lesson, setLesson] = useState<Lesson>();
  const [lessonAttempt, setLessonAttempt] = useState(0);
  const [lessonLoading, setLessonLoading] = useState(false);
  const notesHandle = useRef<NotesHandle | undefined>(undefined);
  const registerNotes = useCallback((handle: NotesHandle | undefined) => { notesHandle.current = handle; }, []);
  const navigationRunning = useRef(false);
  const attemptedNavigation = useRef<string | undefined>(undefined);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && !!notesHandle.current?.dirty());
  useBeforeUnload(useCallback(event => { if (notesHandle.current?.dirty()) { event.preventDefault(); event.returnValue = ''; } }, []));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [navigationError, setNavigationError] = useState('');
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [choiceBusy, setChoiceBusy] = useState(false);
  const finishNavigation = useCallback(async () => {
    if (blocker.state !== 'blocked' || navigationRunning.current) return;
    navigationRunning.current = true; setNavigationBusy(true); setNavigationError('');
    try { await leaveAfterSave(notesHandle.current, () => blocker.proceed()); }
    catch (error) { setNavigationError(error instanceof Error ? error.message : 'Navigation blocked: save failed.'); }
    finally { navigationRunning.current = false; setNavigationBusy(false); }
  }, [blocker]);
  useEffect(() => {
    if (blocker.state !== 'blocked') { attemptedNavigation.current = undefined; return; }
    if (attemptedNavigation.current === blocker.location.key) return;
    attemptedNavigation.current = blocker.location.key; void finishNavigation();
  }, [blocker, finishNavigation]);
  const refresh = () => setAttempt(value => value + 1);
  useEffect(() => {
    let active = true;
    void api('/courses?limit=100', envelope(z.array(courseSchema))).then(value => { if (active) setCourses(value.data); }).catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    let active = true;
    void (courseId ? api(`/courses/${courseId}/tree`, envelope(treeSchema)).then(value => { if (active) { setTree(value.data); setChoiceBusy(false); } }) : Promise.resolve().then(() => { if (active) setTree(undefined); })).catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [courseId, attempt]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return; setLesson(undefined);  setError('');
      if (!topicId) { setLessonLoading(false); return; }
      setLessonLoading(true);
      try { const value = await api(`/topics/${topicId}/lesson`, envelope(lessonSchema)); if (active) { setLesson(value.data);  } }
      catch (error) { if (active && !(error instanceof ApiError && error.code === 'LESSON_NOT_GENERATED')) setError(String(error)); }
      finally { if (active) setLessonLoading(false); }
    });
    return () => { active = false; };
  }, [topicId, lessonAttempt]);
  async function action(work: () => Promise<unknown>) { try { setError(''); await work(); refresh(); } catch (error) { setError(error instanceof Error ? error.message : 'Request failed.'); } }
  async function destructive(work: () => Promise<void>) {
    await action(async () => { try { await leaveAfterSave(notesHandle.current, work); } finally { notesHandle.current?.freeze(false); } });
  }
  const topic = tree?.topics.find(topic => topic.id === topicId);
  function addTopic(parentId: string | null) {
    const title = window.prompt('Topic title'); if (!title || !courseId || !tree) return;
    void action(() => api(`/courses/${courseId}/topics`, envelope(topicMutationSchema), 'POST', { baseTreeRevision: tree.treeRevision, title, kind: 'topic', position: tree.topics.filter(topic => topic.parentId === parentId).length, parentId, objectives: [] }));
  }
  function renderTopics(parentId: string | null): React.ReactNode {
    return <ul>{tree?.topics.filter(topic => topic.parentId === parentId).sort((a, b) => a.position - b.position).map(item => <li key={item.id}><button aria-current={item.id === topicId ? 'page' : undefined} onClick={() => navigate(`/courses/${courseId}/topics/${item.id}`)}>{item.title}</button>{renderTopics(item.id)}</li>)}</ul>;
  }
  function topicControls(item: Topic) {
    if (!tree || !courseId) return null;
    return <div className="editor-toolbar" aria-label="Topic actions">
      <button onClick={() => { const title = window.prompt('Topic title', item.title); if (title) void action(() => api(`/topics/${item.id}`, envelope(topicMutationSchema), 'PATCH', { baseTreeRevision: tree.treeRevision, title })); }}>Rename topic</button>
      <button onClick={() => { const value = window.prompt('Objectives, one per line', item.objectives.join('\n')); if (value !== null) void action(() => api(`/topics/${item.id}`, envelope(topicMutationSchema), 'PATCH', { baseTreeRevision: tree.treeRevision, objectives: value.split('\n').map(value => value.trim()).filter(Boolean) })); }}>Edit objectives</button>
      <button onClick={() => addTopic(item.id)}>Add child</button>
      <button onClick={() => { const containerTitle = window.prompt('Container title'); if (containerTitle) void action(() => api(`/topics/${item.id}/wrap`, envelope(topicMutationSchema), 'POST', { baseTreeRevision: tree.treeRevision, containerTitle })); }}>Wrap topic</button>
      <label>Move topic to <select aria-label="Move topic to" value={item.parentId ?? ''} onChange={event => { const parentId = event.target.value || null; void action(() => api(`/courses/${courseId}/topic-moves`, envelope(treeMutationSchema), 'POST', { baseTreeRevision: tree.treeRevision, topicId: item.id, newParentId: parentId, orderedSiblingIds: [...tree.topics.filter(topic => topic.parentId === parentId && topic.id !== item.id).sort((a, b) => a.position - b.position).map(topic => topic.id), item.id] })); }}><option value="">Course root</option>{tree.topics.filter(topic => topic.id !== item.id && !topic.lessonId).map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
      <button onClick={() => { const siblings = tree.topics.filter(topic => topic.parentId === item.parentId).sort((a, b) => a.position - b.position); const index = siblings.findIndex(topic => topic.id === item.id); if (index > 0) { [siblings[index - 1], siblings[index]] = [siblings[index]!, siblings[index - 1]!]; void action(() => api(`/courses/${courseId}/topic-order`, envelope(treeMutationSchema), 'PUT', { baseTreeRevision: tree.treeRevision, parentId: item.parentId, orderedSiblingIds: siblings.map(topic => topic.id) })); } }}>Move up</button>
      <button onClick={() => { const affected = new Set([item.id]); for (let size = -1; size !== affected.size;) { size = affected.size; tree.topics.forEach(topic => { if (topic.parentId && affected.has(topic.parentId)) affected.add(topic.id); }); } const lessons = tree.topics.filter(topic => affected.has(topic.id) && topic.lessonId).length; if (window.confirm(`Delete ${affected.size} topic(s) and ${lessons} saved lesson(s) at tree revision ${tree.treeRevision}?`)) void destructive(async () => { await api(`/topics/${item.id}`, z.undefined(), 'DELETE', { baseTreeRevision: tree.treeRevision, confirmSubtree: true }); navigate(`/courses/${courseId}`); }); }}>Delete topic</button>
      <details><summary>Prerequisites</summary>{tree.topics.filter(topic => topic.id !== item.id).map(candidate => <label key={candidate.id}><input type="checkbox" checked={tree.prerequisites.some(edge => edge.topicId === item.id && edge.prerequisiteId === candidate.id)} onChange={event => { const current = tree.prerequisites.filter(edge => edge.topicId === item.id).map(edge => edge.prerequisiteId); void action(() => api(`/topics/${item.id}/prerequisites`, envelope(prerequisiteMutationSchema), 'PUT', { baseTreeRevision: tree.treeRevision, prerequisiteIds: event.target.checked ? [...current, candidate.id] : current.filter(id => id !== candidate.id) })); }} />{candidate.title}</label>)}</details>
      {tree.prerequisites.filter(edge => edge.topicId === item.id).map(edge => <label key={edge.prerequisiteId}>Prerequisite: {tree.topics.find(topic => topic.id === edge.prerequisiteId)?.title}<select aria-label={`Prerequisite choice ${edge.prerequisiteId}`} disabled={choiceBusy} value={edge.choice} onChange={event => { setChoiceBusy(true); void action(() => api(`/topics/${item.id}/prerequisites/${edge.prerequisiteId}`, envelope(edgeMutationSchema), 'PATCH', { choice: event.target.value })).finally(() => refresh()); }}><option value="undecided">Undecided</option><option value="study">Study</option><option value="skip">Skip</option></select><button onClick={() => navigate(`/courses/${courseId}/topics/${edge.prerequisiteId}`)}>Open prerequisite</button></label>)}
    </div>;
  }
  return <div className="workspace"><aside><h1>LearnSpace AI</h1><p>Manual learning workspace</p><button onClick={() => { const title = window.prompt('Course title'); if (!title) return; const goal = window.prompt('Learning goal'); if (goal) void action(async () => { const result = await api('/courses', envelope(courseSchema), 'POST', { title, goal, preferences: coursePreferences }); navigate(`/courses/${result.data.id}`); }); }}>New course</button><nav aria-label="Courses">{courses.map(course => <button key={course.id} aria-current={course.id === courseId ? 'page' : undefined} onClick={() => navigate(`/courses/${course.id}`)}>{course.title}</button>)}</nav>{courseId && tree && <><h2>Topics</h2><button onClick={() => addTopic(null)}>Add root topic</button>{renderTopics(null)}</>}</aside>
    <main><ModelSettings onPreferences={setCoursePreferences} /><a href="#notes">Skip to notes</a>{error && <div role="alert" className="notice">{error}<button onClick={refresh}>Reload tree</button></div>}
      {!courseId && <h2>Create a course to start your notes.</h2>}
      {courseId && <CourseOperations key={`operations:${courseId}`} courseId={courseId} startedId={startedOperation?.courseId === courseId ? startedOperation.id : undefined} />}
      {courseId && tree && !tree.topics.length && <SyllabusStart key={`syllabus:${courseId}`} courseId={courseId} treeRevision={tree.treeRevision} onStarted={id => setStartedOperation({ courseId, id })} />}
      {courseId && topic?.isLeaf && !lesson && !lessonLoading && <InitialGeneration key={topic.id} topicId={topic.id} onStarted={id => setStartedOperation({ courseId, id })} onLesson={setLesson} />}
      {courseId && !topic && <h2>{courses.find(course => course.id === courseId)?.title ?? 'Course'}</h2>}
      {courseId && tree && <details><summary>Course settings</summary><button onClick={() => { const title = window.prompt('Course title', courses.find(course => course.id === courseId)?.title); if (title) void action(() => api(`/courses/${courseId}`, envelope(courseSchema), 'PATCH', { baseTreeRevision: tree.treeRevision, title })); }}>Rename course</button><button onClick={() => { if (window.confirm(`Delete this course, ${tree.topics.length} topic(s), and ${tree.topics.filter(topic => topic.lessonId).length} saved lesson(s)?`)) void destructive(async () => { await api(`/courses/${courseId}`, z.undefined(), 'DELETE', { baseTreeRevision: tree.treeRevision, confirm: true }); navigate('/'); }); }}>Delete course</button></details>}
      {courseId && tree && courses.find(course => course.id === courseId) && <details><summary>Teaching preferences for this course</summary><CoursePreferences key={courseId} course={courses.find(course => course.id === courseId)!} treeRevision={tree.treeRevision} onSaved={refresh} /></details>}
      {courseId && tree && <ProgressControls key={`progress:${courseId}`} courseId={courseId} topicId={topicId} treeRevision={tree.treeRevision} />}
      {topic && <><h2>{topic.title}</h2>{topicControls(topic)}<section aria-label="Current topic objectives"><h3>Current topic objectives</h3>{topic.objectives.length ? <ul>{topic.objectives.map((objective, index) => <li key={index}>{objective}</li>)}</ul> : <p>No current objectives entered.</p>}<p>These are current topic metadata; saved lesson objective prose is preserved separately.</p></section>{topic.isLeaf && !lesson && <><button disabled={lessonLoading} onClick={() => void action(async () => { const result = await api(`/topics/${topic.id}/lessons`, envelope(lessonSchema), 'POST', { mutationId: crypto.randomUUID(), documentSchemaVersion: 1, document: blankDocument() }); setLesson(result.data);  })}>Create blank notes</button><button disabled={lessonLoading} onClick={() => setLessonAttempt(value => value + 1)}>Retry loading notes</button>{lessonLoading && <p role="status">Loading saved notes…</p>}</>}</>}
      {blocker.state === 'blocked' && <section className="notice" aria-label="Navigation protection"><p role="status">{navigationBusy ? 'Saving notes before leaving…' : navigationError || 'Navigation is paused.'}</p><button disabled={navigationBusy} onClick={() => void finishNavigation()}>Retry navigation save</button><button disabled={navigationBusy} onClick={() => { blocker.reset(); setNavigationError(''); }}>Stay here</button><button onClick={() => notesHandle.current?.download()}>Download local recovery</button></section>}
      <div id="notes">{lesson && courseId && <PersistentNotes key={lesson.id} lesson={lesson} courseId={courseId} onHandle={registerNotes} preferences={courses.find(course => course.id === courseId)?.preferences} />}</div>
    </main></div>;
}
