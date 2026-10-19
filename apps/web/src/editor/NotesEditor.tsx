import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import { wrapInList } from '@tiptap/pm/schema-list';
import { undo, redo } from '@tiptap/pm/history';
import { assetSchema, type TiptapDocument } from '@learnspace/shared';
import { manualExtensions, validatedEditorJSON, blankDocument } from './extensions';
import { envelope } from '../api';

interface Props { document: TiptapDocument; courseId: string; disabled: boolean; label?: string; onChange: (document: TiptapDocument) => void; onValidity?: (invalid: boolean) => void; onReady?: (editor: Editor) => void }
export function NotesEditor({ document, courseId, disabled, label = 'Lesson notes', onChange, onValidity, onReady }: Props) {
  const notifyReady = useEffectEvent((value: Editor) => onReady?.(value));
  const [message, setMessage] = useState('');
  const sequence = useRef(0);
  const [renderedSequence, setRenderedSequence] = useState(0);
  const [pendingImage, setPendingImage] = useState<{ id: string; width: number; height: number; alt: string; caption: string; position: number; sequence: number }>();
  const editor = useEditor({ extensions: manualExtensions, content: document, editable: !disabled,
    editorProps: { attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', 'aria-readonly': String(disabled) } },
    onUpdate: ({ editor }) => {
      sequence.current++;
      setRenderedSequence(sequence.current);
      try { onChange(validatedEditorJSON(editor.getJSON())); onValidity?.(false); setMessage(''); }
      catch { onValidity?.(true); setMessage('This structure cannot be saved. Undo or correct it; your editor content is retained.'); }
    }
  });
  useEffect(() => { if (editor) notifyReady(editor); }, [editor]);
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled, false);
    editor.view.dom.setAttribute('aria-readonly', String(disabled));
  }, [editor, disabled]);
  // Editable state is controlled without replacing the document after saves.
  if (!editor) return <p>Loading editor…</p>;
  const insert = (type: string, attrs: Record<string, unknown> = {}, content?: JSONContent[]) => editor.chain().focus().insertContent({ type, attrs, ...(content ? { content } : {}) }).run();
  const textAttribute = (type: string, label: string) => {
    const latex = window.prompt(label); if (latex?.trim()) insert(type, { latex, ...(type === 'mathBlock' ? { blockId: crypto.randomUUID() } : {}) });
  };
  async function upload(file: File) {
    const current = editor!; const position = current.state.selection.from; const captured = sequence.current;
    try {
      const body = new FormData(); body.append('file', file);
      const response = await fetch(`/api/v1/courses/${courseId}/assets`, { method: 'POST', headers: { 'X-LearnSpace-Request': '1' }, body });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error('Upload failed. Choose a valid PNG, JPEG or WebP up to 10 MiB.');
      const asset = envelope(assetSchema).parse(raw).data;
      setPendingImage({ id: asset.id, width: asset.width, height: asset.height, alt: file.name, caption: '', position, sequence: captured });
      setMessage('Image uploaded. Preview it and confirm placement.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Upload failed.'); }
  }
  const button = (label: string, action: () => unknown) => <button type="button" disabled={disabled} onClick={action}>{label}</button>;
  return <section aria-label="Notes editor">
    <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
      {(['bold', 'italic', 'strike', 'underline', 'code'] as const).map(mark => <button type="button" key={mark} disabled={disabled} aria-pressed={editor.isActive(mark)} onClick={() => editor.chain().focus().toggleMark(mark).run()}>{mark[0]!.toUpperCase() + mark.slice(1)}</button>)}
      {button('Paragraph', () => editor.chain().focus().setNode('paragraph').run())}
      <label>Heading <select aria-label="Heading level" disabled={disabled} defaultValue="" onChange={event => { editor.chain().focus().setNode('heading', { level: Number(event.target.value) }).run(); event.target.value = ''; }}><option value="" disabled>Choose</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>{level}</option>)}</select></label>
      {button('Bullet list', () => wrapInList(editor.schema.nodes.bulletList!)(editor.state, editor.view.dispatch))}
      {button('Numbered list', () => wrapInList(editor.schema.nodes.orderedList!, { start: Number(window.prompt('Start number', '1') ?? 1) })(editor.state, editor.view.dispatch))}
      {button('Quote', () => editor.chain().focus().toggleWrap('blockquote').run())}
      {button('Code block', () => editor.chain().focus().setNode('codeBlock', { language: window.prompt('Code language', 'typescript') ?? '' }).run())}
      {button('Rule', () => insert('horizontalRule', { blockId: crypto.randomUUID() }))}
      {button('Link', () => { const href = window.prompt('Link URL (https, http or mailto)'); if (href && /^(https?:\/\/|mailto:)/i.test(href)) editor.chain().focus().setMark('link', { href }).run(); })}
      {button('Remove link', () => editor.chain().focus().unsetMark('link').run())}
      {button('Inline math', () => textAttribute('mathInline', 'LaTeX expression'))}
      {button('Math block', () => textAttribute('mathBlock', 'LaTeX expression'))}
      {(['exampleBlock', 'analogyBlock'] as const).map(type => <button key={type} disabled={disabled} onClick={() => editor.chain().focus().toggleWrap(type, { label: type === 'exampleBlock' ? 'Example' : 'Analogy' }).run()}>{type === 'exampleBlock' ? 'Example' : 'Analogy'}</button>)}
      {button('Insert table', () => {
        const count = Number(window.prompt('Columns (1–10)', '2')); const rows = Number(window.prompt('Rows (1–20)', '2'));
        if (!Number.isInteger(count) || count < 1 || count > 10 || !Number.isInteger(rows) || rows < 1 || rows > 20) return;
        insert('table', { blockId: crypto.randomUUID() }, Array.from({ length: rows }, (_, row) => ({ type: 'tableRow', attrs: { blockId: crypto.randomUUID() }, content: Array.from({ length: count }, () => ({ type: row === 0 ? 'tableHeader' : 'tableCell', attrs: { blockId: crypto.randomUUID() }, content: blankDocument().content })) })));
      })}
      {button('Undo', () => undo(editor.state, editor.view.dispatch))}{button('Redo', () => redo(editor.state, editor.view.dispatch))}
      {button('Remove selected image', () => {
        if (editor.state.selection instanceof NodeSelection && editor.state.selection.node.type.name === 'image') editor.commands.deleteSelection();
        else setMessage('Select an image in the notes first.');
      })}
      {button('Edit selected image', () => {
        if (!(editor.state.selection instanceof NodeSelection) || editor.state.selection.node.type.name !== 'image') { setMessage('Select an image in the notes first.'); return; }
        const attrs = editor.state.selection.node.attrs;
        const alt = window.prompt('Image description', String(attrs.alt)); if (alt === null) return;
        const caption = window.prompt('Image caption', String(attrs.caption ?? '')); if (caption === null) return;
        editor.commands.updateAttributes('image', { alt, caption });
      })}
      <label className="upload-label">Upload image<input aria-label="Upload image" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label>
    </div>
    {pendingImage && <div className="notice"><img src={`/api/v1/assets/${pendingImage.id}/content`} alt="Upload preview" width="160" /><label>Image description<input value={pendingImage.alt} onChange={event => setPendingImage({ ...pendingImage, alt: event.target.value })} /></label><label>Image caption<input value={pendingImage.caption} onChange={event => setPendingImage({ ...pendingImage, caption: event.target.value })} /></label><button disabled={disabled} onClick={() => {
      const unchanged = sequence.current === pendingImage.sequence;
      const position = unchanged ? pendingImage.position : editor.state.selection.from;
      editor.chain().focus().insertContentAt(position, { type: 'image', attrs: { blockId: crypto.randomUUID(), assetId: pendingImage.id, alt: pendingImage.alt, caption: pendingImage.caption, width: pendingImage.width, height: pendingImage.height } }).run(); setPendingImage(undefined);
    }}>{renderedSequence === pendingImage.sequence ? 'Insert image at captured cursor' : 'Insert image at current cursor'}</button><button onClick={() => setPendingImage(undefined)}>Cancel image</button></div>}
    {message && <p role="status">{message}</p>}
    <EditorContent editor={editor} />
  </section>;
}
