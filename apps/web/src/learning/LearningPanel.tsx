import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { defaultPreferences, type Preferences } from '@learnspace/shared';
import type { InsertionSource } from '../editor/InsertionPreview';
import { validatedEditorJSON } from '../editor/extensions';
import { hiddenLearningBlocks, learningProjection, learningText, readingKey } from './presentation';

export function LearningPanel({ editor, reading, preferences = defaultPreferences, onMode, onInsert, onScratch }: { editor?: Editor; reading: boolean; preferences?: Preferences; onMode: () => Promise<void>; onInsert: (source: InsertionSource) => void; onScratch: (dirty: boolean) => void }) {
  const [revision, setRevision] = useState(0); const [section, setSection] = useState(0); const [showAll, setShowAll] = useState(false);
  const [continued, setContinued] = useState<Set<string>>(new Set()); const [revealed, setRevealed] = useState<Set<string>>(new Set()); const [scratch, setScratch] = useState<Record<string, string>>({}); const [error, setError] = useState('');
  useEffect(() => { if (!editor) return; const update = () => setRevision(value => value + 1); editor.on('update', update); return () => { editor.off('update', update); }; }, [editor]);
  useEffect(() => { onScratch(Object.values(scratch).some(value => value.length > 0)); return () => onScratch(false); }, [scratch, onScratch]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const document = validatedEditorJSON(editor.getJSON()); const hidden = hiddenLearningBlocks(document, { reading, guided: preferences.pace === 'guided', section, reflectionPauses: preferences.reflectionPauses, continued, revealed, showAll });
    editor.view.dispatch(editor.state.tr.setMeta(readingKey, hidden).setMeta('addToHistory', false));
  }, [editor, reading, preferences.pace, preferences.reflectionPauses, section, continued, revealed, showAll, revision]);
  const projection = editor ? learningProjection(validatedEditorJSON(editor.getJSON())) : undefined;
  return <section aria-label="Learning controls"><button onClick={() => { void onMode().catch(error => setError(error instanceof Error ? error.message : 'Mode change failed.')); }}>{reading ? 'Edit notes' : 'Read and practice'}</button>{error && <p role="alert">{error}</p>}
    {reading && <><p>Reading mode · presentation only. Practice answers are not saved or graded.</p><button onClick={() => setShowAll(value => !value)}>{showAll ? 'Use learning gates' : 'Show all saved content'}</button>{preferences.pace === 'guided' && <><p>Section {Math.min(section + 1, projection?.sectionCount ?? 1)} of {projection?.sectionCount ?? 1}</p><button disabled={section <= 0} onClick={() => setSection(value => value - 1)}>Previous section</button><button disabled={section >= (projection?.sectionCount ?? 1) - 1} onClick={() => setSection(value => value + 1)}>Continue section</button></>}
      {preferences.reflectionPauses && projection?.reflections.map(id => <button key={id} disabled={continued.has(id)} onClick={() => setContinued(prior => new Set([...prior, id]))}>Continue after reflection {projection.reflections.indexOf(id) + 1}</button>)}
      {projection?.malformed && <p>Recall metadata is incomplete or ambiguous. All saved content remains visible.</p>}
      {!projection?.pairs.length && <p>No paired recall practice in these notes. No questions were generated automatically.</p>}
      {projection?.pairs.map(pair => <section key={pair.id} aria-label="Recall practice"><h4>{learningText(pair.question)}</h4><label>Practice only — not saved<textarea aria-label={`Practice answer ${pair.id}`} maxLength={16000} value={scratch[pair.id] ?? ''} onChange={event => setScratch(prior => ({ ...prior, [pair.id]: event.target.value }))} /></label><button onClick={() => setRevealed(prior => new Set([...prior, pair.id]))}>Reveal recall answer</button>{revealed.has(pair.id) && <p>{learningText(pair.answer)}</p>}<button disabled={!scratch[pair.id]?.trim()} onClick={() => { onInsert({ text: scratch[pair.id]!, source: { kind: 'recall_insert' }, label: 'Your transient practice answer. Insert as plain text without replacing the saved recall answer.' }); }}>Insert my answer</button><button onClick={() => { if (!scratch[pair.id] || window.confirm('Discard this unsaved practice answer?')) setScratch(prior => ({ ...prior, [pair.id]: '' })); }}>Discard practice answer</button></section>)}
    </>}
  </section>;
}
