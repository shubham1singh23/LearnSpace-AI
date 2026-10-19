import type { Editor } from '@tiptap/react';
import { Step } from '@tiptap/pm/transform';
import { closeHistory } from '@tiptap/pm/history';
import { canonicalJSON, transformEdit, type PreparedEdit } from '@learnspace/shared';
import { acceptanceBarrierKey, documentSequence } from './selection-plugin';
import { validatedEditorJSON } from './extensions';
import type { Autosave } from '../persistence/autosave';

export function pauseAcceptance(editor: Editor, paused: boolean) {
  editor.view.dispatch(editor.state.tr.setMeta(acceptanceBarrierKey, paused).setMeta('addToHistory', false));
}
export async function acceptEdit(editor: Editor, queue: Autosave, operationId: string, prepared: PreparedEdit, expectedSequence: number) {
  if (queue.dirty || documentSequence(editor.state) !== expectedSequence || queue.currentRevision !== prepared.target.baseRevision) throw new Error('Selection proposal is stale.');
  pauseAcceptance(editor, true);
  try {
    const source = validatedEditorJSON(editor.getJSON());
    const result = await transformEdit(source, prepared);
    if (documentSequence(editor.state) !== expectedSequence) throw new Error('Selection proposal became stale.');
    const transaction = closeHistory(editor.state.tr);
    for (const step of result.steps) transaction.step(Step.fromJSON(editor.schema, step.toJSON()));
    if (canonicalJSON(validatedEditorJSON(transaction.doc.toJSON())) !== canonicalJSON(result.document)) throw new Error('Editor transformation mismatch.');
    await queue.acceptEdit(operationId, result.document, () => {
      if (documentSequence(editor.state) !== expectedSequence) throw new Error('Selection proposal became stale before dispatch.');
      editor.view.dispatch(transaction.setMeta('learnspaceAcceptedEdit', true));
      editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false));
    });
  } finally { if (!queue.isolatedPending) pauseAcceptance(editor, false); }
}
