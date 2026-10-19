// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { Step } from '@tiptap/pm/transform';
import { undo, redo, closeHistory } from '@tiptap/pm/history';
import { afterEach, describe, expect, it } from 'vitest';
import { allNodesFixture } from '../../../../tests/fixtures/document.js';
import { joinBackward } from '@tiptap/pm/commands';
import { manualExtensions, validatedEditorJSON, blankDocument } from './extensions';
import { documentSequence } from './selection-plugin';
import { captureSelection, transformEdit } from '@learnspace/shared';
import { Autosave } from '../persistence/autosave';
import { acceptEdit } from './accept-edit';
import { insertText, previewInsertion } from './insert-text';
import { readingKey } from '../learning/presentation';

const editors: Editor[] = [];
function create(content: object = blankDocument()) {
  const editor = new Editor({ element: document.createElement('div'), extensions: manualExtensions, content });
  editors.push(editor); return editor;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
describe('Phase 5 editor gate', () => {
  it('changes learning presentation without a document transaction, undo event or canonical mutation', () => {
    const editor = create(); editor.commands.insertContent('Saved teaching'); const before = validatedEditorJSON(editor.getJSON()); const sequence = documentSequence(editor.state);
    editor.view.dispatch(editor.state.tr.setMeta(readingKey, new Set([String(before.content[0]?.attrs?.blockId)])).setMeta('addToHistory', false));
    expect(documentSequence(editor.state)).toBe(sequence); expect(validatedEditorJSON(editor.getJSON())).toEqual(before); expect(editor.view.dom.querySelector('p')?.style.display).toBe('none');
    editor.view.dispatch(editor.state.tr.setMeta(readingKey, new Set()).setMeta('addToHistory', false)); expect(documentSequence(editor.state)).toBe(sequence); expect(validatedEditorJSON(editor.getJSON())).toEqual(before);
  });
  it('inserts at the captured cursor despite caret movement, as one journaled manual undo event', async () => {
    const editor = create(); editor.commands.insertContent('Before'); editor.commands.setTextSelection(3); const before = validatedEditorJSON(editor.getJSON()); let journaled = false;
    const queue: Autosave = new Autosave({ id: crypto.randomUUID(), topicId: crypto.randomUUID(), revision: 1, documentSchemaVersion: 1, document: before, updatedAt: new Date().toISOString() }, { get: async () => undefined, put: async () => { journaled = true; }, remove: async () => undefined }, async body => { expect(body.aiOperationId).toBeUndefined(); return { id: queue.lesson.id, mutationId: body.mutationId, revision: 2, updatedAt: new Date().toISOString(), contentHash: 'a'.repeat(64) }; }, () => undefined);
    editor.on('update', () => { expect(journaled).toBe(true); queue.edit(validatedEditorJSON(editor.getJSON())); });
    const anchor = await previewInsertion(editor, queue, 'Answer', { kind: 'chat_insert', sourceId: crypto.randomUUID() }); editor.commands.setTextSelection(7);
    await insertText(editor, queue, anchor, 'Answer'); expect(editor.state.doc.textContent).toBe('BeAnswerfore');
    undo(editor.state, editor.view.dispatch); expect(validatedEditorJSON(editor.getJSON())).toEqual(before); redo(editor.state, editor.view.dispatch); expect(editor.state.doc.textContent).toBe('BeAnswerfore'); queue.stop();
  });
  it('rejects an insertion after a document transaction even when undo returns to identical text', async () => {
    const editor = create(); editor.commands.insertContent('Before'); const before = validatedEditorJSON(editor.getJSON());
    const queue = new Autosave({ id: crypto.randomUUID(), topicId: crypto.randomUUID(), revision: 1, documentSchemaVersion: 1, document: before, updatedAt: new Date().toISOString() }, { get: async () => undefined, put: async () => undefined, remove: async () => undefined }, async () => { throw new Error('Must not send'); }, () => undefined);
    const anchor = await previewInsertion(editor, queue, 'Answer', { kind: 'recall_insert' });
    editor.view.dispatch(closeHistory(editor.state.tr)); editor.commands.insertContent('Outside'); undo(editor.state, editor.view.dispatch);
    expect(validatedEditorJSON(editor.getJSON())).toEqual(before); await expect(insertText(editor, queue, anchor, 'Answer')).rejects.toThrow('stale'); queue.stop();
  });
  it('journals before the exact live transaction and blocks new transactions until acknowledgement', async () => {
    const editor = create(); editor.commands.insertContent('Before'); const before = validatedEditorJSON(editor.getJSON());
    const target = await captureSelection(before, 1, 1, 7); let journaled = false; let release!: () => void; let sending!: () => void;
    const started = new Promise<void>(done => { sending = done; }); const wait = new Promise<void>(done => { release = done; });
    const queue: Autosave = new Autosave({ id: crypto.randomUUID(), topicId: crypto.randomUUID(), revision: 1, documentSchemaVersion: 1, document: before, updatedAt: new Date().toISOString() }, { get: async () => undefined, put: async () => { journaled = true; }, remove: async () => undefined }, async body => { sending(); await wait; return { id: queue.lesson.id, mutationId: body.mutationId, revision: 2, updatedAt: new Date().toISOString(), contentHash: 'a'.repeat(64) }; }, () => undefined);
    editor.on('update', () => { expect(journaled).toBe(true); queue.edit(validatedEditorJSON(editor.getJSON())); });
    const work = acceptEdit(editor, queue, crypto.randomUUID(), { action: 'rewrite', mode: 'replace', target, fragment: { kind: 'inline', content: [{ type: 'text', text: 'After' }] }, formattingChanged: false }, documentSequence(editor.state));
    await started; expect(editor.state.doc.textContent).toBe('After'); editor.commands.insertContent('Blocked'); expect(editor.state.doc.textContent).toBe('After'); undo(editor.state, editor.view.dispatch); expect(editor.state.doc.textContent).toBe('After');
    release(); await work; undo(editor.state, editor.view.dispatch); expect(validatedEditorJSON(editor.getJSON())).toEqual(before); redo(editor.state, editor.view.dispatch); expect(editor.state.doc.textContent).toBe('After'); queue.stop();
  });
  it('applies shared exact steps as one isolated undo/redo event', async () => {
    const editor = create(); editor.commands.insertContent('Before'); const before = validatedEditorJSON(editor.getJSON());
    const target = await captureSelection(before, 1, 1, 7);
    const result = await transformEdit(before, { action: 'rewrite', mode: 'replace', target, fragment: { kind: 'inline', content: [{ type: 'text', text: 'After' }] }, formattingChanged: false });
    const tr = closeHistory(editor.state.tr); for (const step of result.steps) tr.step(Step.fromJSON(editor.schema, step.toJSON())); editor.view.dispatch(tr); editor.view.dispatch(closeHistory(editor.state.tr));
    expect(validatedEditorJSON(editor.getJSON())).toEqual(result.document); undo(editor.state, editor.view.dispatch); expect(validatedEditorJSON(editor.getJSON())).toEqual(before); redo(editor.state, editor.view.dispatch); expect(validatedEditorJSON(editor.getJSON())).toEqual(result.document);
  });
  it('keeps the original owner when a copy is inserted before it and counts undo but not selection movement', () => {
    const initial = blankDocument(); const id = initial.content[0]!.attrs.blockId; const editor = create(initial);
    editor.commands.insertContent('Original'); const original = validatedEditorJSON(editor.getJSON()).content[0]!;
    const before = documentSequence(editor.state); editor.commands.setTextSelection(2); expect(documentSequence(editor.state)).toBe(before);
    editor.view.dispatch(closeHistory(editor.state.tr)); editor.commands.insertContentAt(0, original);
    const copied = validatedEditorJSON(editor.getJSON()); expect(copied.content[1]?.attrs?.blockId).toBe(id); expect(copied.content[0]?.attrs?.blockId).not.toBe(id);
    const changed = documentSequence(editor.state); expect(changed).toBeGreaterThan(before); undo(editor.state, editor.view.dispatch); expect(documentSequence(editor.state)).toBeGreaterThan(changed);
  });
  it('preserves block identity across a move transaction and the surviving ID on join', () => {
    const first = blankDocument().content[0]!; const second = blankDocument().content[0]!;
    const editor = create({ type: 'doc', content: [{ ...first, content: [{ type: 'text', text: 'First' }] }, { ...second, content: [{ type: 'text', text: 'Second' }] }] });
    const node = editor.state.doc.firstChild!; const tr = editor.state.tr.delete(0, node.nodeSize); tr.insert(tr.doc.content.size, node); editor.view.dispatch(tr);
    const moved = validatedEditorJSON(editor.getJSON()); expect(moved.content.map(item => item.attrs?.blockId)).toEqual([second.attrs.blockId, first.attrs.blockId]);
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize + 1); joinBackward(editor.state, editor.view.dispatch);
    expect(validatedEditorJSON(editor.getJSON()).content[0]?.attrs?.blockId).toBe(second.attrs.blockId);
  });
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

