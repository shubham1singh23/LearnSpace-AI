import type { Editor } from '@tiptap/react';
import { Step } from '@tiptap/pm/transform';
import { closeHistory } from '@tiptap/pm/history';
import { canonicalJSON, captureInsertion, fingerprint, transformInsertion, type InsertionAnchor, type InsertionIsolation } from '@learnspace/shared';
import type { Autosave } from '../persistence/autosave';
import { documentSequence } from './selection-plugin';
import { validatedEditorJSON } from './extensions';
import { pauseAcceptance } from './accept-edit';

const identities = new WeakMap<Editor, string>();
function identity(editor: Editor) { let id = identities.get(editor); if (!id) { id = crypto.randomUUID(); identities.set(editor, id); } return id; }
export async function previewInsertion(editor: Editor, queue: Autosave, text: string, source: Omit<InsertionIsolation, 'sourceHash'>) {
  if (queue.dirty || !editor.state.selection.empty) throw new Error('Save notes and place a collapsed cursor in a text block.');
  const documentSequenceValue = documentSequence(editor.state); const localSequence = queue.localSequence;
  const anchor = await captureInsertion(validatedEditorJSON(editor.getJSON()), editor.state.selection.from, { lessonId: queue.lesson.id, baseRevision: queue.currentRevision, editorInstanceId: identity(editor), documentSequence: documentSequenceValue, localSequence, source: { ...source, sourceHash: await fingerprint(text) } });
  if (documentSequence(editor.state) !== documentSequenceValue || queue.localSequence !== localSequence) throw new Error('Insertion became stale. Capture a fresh cursor.');
  await transformInsertion(queue.snapshot, anchor, text); return anchor;
}
export async function insertText(editor: Editor, queue: Autosave, anchor: InsertionAnchor, text: string) {
  const fresh = () => !editor.isDestroyed && identity(editor) === anchor.editorInstanceId && queue.lesson.id === anchor.lessonId && queue.currentRevision === anchor.baseRevision && !queue.dirty && queue.localSequence === anchor.localSequence && documentSequence(editor.state) === anchor.documentSequence;
  if (!fresh()) throw new Error('Insertion is stale. Place a fresh cursor and preview again.');
  pauseAcceptance(editor, true);
  try {
    const result = await transformInsertion(validatedEditorJSON(editor.getJSON()), anchor, text);
    if (!fresh()) throw new Error('Insertion became stale.');
    const transaction = closeHistory(editor.state.tr); for (const step of result.steps) transaction.step(Step.fromJSON(editor.schema, step.toJSON()));
    if (canonicalJSON(validatedEditorJSON(transaction.doc.toJSON())) !== canonicalJSON(result.document)) throw new Error('Insertion transformation mismatch.');
    await queue.insertText(anchor.source, result.document, () => {
      if (editor.isDestroyed || documentSequence(editor.state) !== anchor.documentSequence) throw new Error('Insertion became stale before dispatch.');
      editor.view.dispatch(transaction.setMeta('learnspaceAcceptedEdit', true)); editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false));
    });
  } finally { if (!queue.isolatedPending) pauseAcceptance(editor, false); }
}
