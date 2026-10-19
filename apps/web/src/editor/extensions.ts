import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { baseKeymap } from '@tiptap/pm/commands';
import { keymap } from '@tiptap/pm/keymap';
import { splitListItem, liftListItem, sinkListItem } from '@tiptap/pm/schema-list';
import { documentExtensions, editorJSON, tiptapDocumentSchema } from '@learnspace/shared';

export const editorBehavior = Extension.create({
  name: 'manualEditorBehavior',
  addProseMirrorPlugins() {
    return [history(), keymap({
      'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo,
      Enter: splitListItem(this.editor.schema.nodes.listItem!),
      Tab: sinkListItem(this.editor.schema.nodes.listItem!),
      'Shift-Tab': liftListItem(this.editor.schema.nodes.listItem!)
    }), keymap(baseKeymap), new Plugin({
      appendTransaction(transactions, _old, state) {
        if (!transactions.some(transaction => transaction.docChanged)) return null;
        const ids = new Set<string>(); const tr = state.tr;
        state.doc.descendants((node, position) => {
          if (!('blockId' in node.attrs)) return;
          const id: unknown = node.attrs.blockId;
          if (typeof id !== 'string' || ids.has(id)) {
            const fresh = crypto.randomUUID(); ids.add(fresh);
            tr.setNodeMarkup(position, undefined, { ...node.attrs, blockId: fresh });
          } else ids.add(id);
        });
        return tr.docChanged ? tr : null;
      }
    })];
  }
});
export const manualExtensions = [...documentExtensions, editorBehavior];
export const validatedEditorJSON = (value: unknown) => tiptapDocumentSchema.parse(editorJSON(value));
export const blankDocument = () => ({ type: 'doc' as const, content: [{ type: 'paragraph' as const, attrs: { blockId: crypto.randomUUID() }, content: [] }] });
