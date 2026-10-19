import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';

const sequenceKey = new PluginKey<number>('selectionDocumentSequence');
export const documentSequencePlugin = new Plugin<number>({ key: sequenceKey, state: { init: () => 0, apply: (transaction, value) => value + (transaction.docChanged ? 1 : 0) } });
export const documentSequence = (state: EditorState) => sequenceKey.getState(state) ?? 0;

export const acceptanceBarrierKey = new PluginKey<boolean>('isolatedAiAcceptance');
export const acceptanceBarrierPlugin = new Plugin<boolean>({
  key: acceptanceBarrierKey,
  state: { init: () => false, apply: (transaction, value) => { const next: unknown = transaction.getMeta(acceptanceBarrierKey); return typeof next === 'boolean' ? next : value; } },
  filterTransaction: (transaction, state) => !acceptanceBarrierKey.getState(state) || !transaction.docChanged || transaction.getMeta('learnspaceAcceptedEdit') === true
});
