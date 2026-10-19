// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { undo, redo, closeHistory } from '@tiptap/pm/history';
import { afterEach, describe, expect, it } from 'vitest';
import { allNodesFixture } from '../../../../tests/fixtures/document.js';
import { joinBackward } from '@tiptap/pm/commands';
import { manualExtensions, validatedEditorJSON, blankDocument } from './extensions';

const editors: Editor[] = [];
function create(content: object = blankDocument()) {
  const editor = new Editor({ element: document.createElement('div'), extensions: manualExtensions, content });
  editors.push(editor); return editor;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
describe('Phase 5 editor gate', () => {
  it('loads and serializes all supported content without losing attributes or text', () => {
    const fixture = allNodesFixture(); const editor = create(fixture);
    expect(validatedEditorJSON(editor.getJSON())).toEqual(fixture);
    expect(editor.view.dom.innerHTML).toContain('/api/v1/assets/');
  });
  it('gives split and copied blocks unique IDs, preserving one original ID and undo/redo', () => {
    const initial = blankDocument(); const id = initial.content[0]!.attrs.blockId;
    const editor = create(initial);
    editor.commands.insertContent('alpha beta');
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.commands.setTextSelection(6); editor.commands.splitBlock();
    const split = validatedEditorJSON(editor.getJSON());
    expect(split.content).toHaveLength(2);
    expect(split.content[0]?.attrs?.blockId).toBe(id);
    expect(split.content[1]?.attrs?.blockId).not.toBe(id);
    undo(editor.state, editor.view.dispatch);
    expect(editor.state.doc.textContent).toBe('alpha beta');
    expect(editor.state.doc.childCount).toBe(1);
    redo(editor.state, editor.view.dispatch);
    expect(editor.state.doc.childCount).toBe(2);
    editor.commands.insertContentAt(editor.state.doc.content.size, split.content[0]!);
    const copied = validatedEditorJSON(editor.getJSON());
    expect(new Set(copied.content.map(node => node.attrs?.blockId)).size).toBe(copied.content.length);
  });
  it('keeps untouched blocks and marks when editing an emoji selection and joins valid blocks', () => {
    const fixture = allNodesFixture(); const editor = create(fixture);
    const before = validatedEditorJSON(editor.getJSON());
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 8)).insertText('🙂'));
    const after = validatedEditorJSON(editor.getJSON());
    expect(after.content.slice(1)).toEqual(before.content.slice(1));
    expect(editor.state.doc.firstChild?.textContent).toBe('🙂');
    const simple = create({ type: 'doc', content: [blankDocument().content[0], blankDocument().content[0]] });
    simple.commands.setTextSelection(3);
    joinBackward(simple.state, simple.view.dispatch);
    expect(validatedEditorJSON(simple.getJSON()).content).toHaveLength(1);
  });
});

