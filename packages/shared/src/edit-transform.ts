import { Fragment } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { editorJSON, editorSchema, tiptapDocumentSchema, type DocumentMark, type DocumentNode, type TiptapDocument } from './document.js';
import { canonicalJSON, preparedEditSchema, type PreparedEdit } from './edit-contracts.js';
import { captureSelection, SelectionError } from './selection.js';

export function commonMarks(nodes: DocumentNode[]): { marks: DocumentMark[]; mixed: boolean } {
  const runs: DocumentMark[][] = [];
  const walk = (node: DocumentNode) => { if (node.type === 'text') runs.push(node.marks ?? []); node.content?.forEach(walk); }; nodes.forEach(walk);
  const first = runs[0] ?? []; const marks = first.filter(mark => runs.every(run => run.some(item => canonicalJSON(item) === canonicalJSON(mark))));
  return { marks, mixed: runs.some(run => canonicalJSON(run) !== canonicalJSON(marks)) };
}
export function textFragment(value: string, marks: DocumentMark[] = []): DocumentNode[] {
  return value.split(/\r\n|\n|\r/).flatMap((part, index) => [...(index ? [{ type: 'hardBreak' as const }] : []), ...(part ? [{ type: 'text' as const, text: part, ...(marks.length ? { marks } : {}) }] : [])]);
}
/** Returns exact replace steps. Both the live editor and server use these steps. */
export async function transformEdit(input: TiptapDocument, raw: PreparedEdit) {
  const prepared = preparedEditSchema.parse(raw); const source = tiptapDocumentSchema.parse(input);
  const target = await captureSelection(source, prepared.target.baseRevision, prepared.target.from, prepared.target.to);
  if (canonicalJSON(target) !== canonicalJSON(prepared.target)) throw new SelectionError('TARGET_MISMATCH', 'Selection identity changed.');
  const doc = editorSchema.nodeFromJSON(source); const transform = new Transform(doc);
  const content = Fragment.fromArray(prepared.fragment.content.map(node => editorSchema.nodeFromJSON(node)));
  try {
    if (prepared.mode === 'insert_after') {
      if (prepared.fragment.kind !== 'blocks') throw new Error('Insertion needs blocks');
      transform.insert(target.anchor, content);
    } else {
      if (target.kind !== prepared.fragment.kind) throw new Error('Fragment shape mismatch');
      if (target.kind === 'blocks' && prepared.fragment.content.length !== target.blocks.length) throw new Error('Keep selected block shells');
      if (target.kind === 'blocks') prepared.fragment.content.forEach((node, index) => { const old = target.blocks[index]!; if (node.type !== old.type || canonicalJSON(node.attrs) !== canonicalJSON(old.attrs)) throw new Error('Changed block metadata'); });
      transform.replaceWith(target.replaceFrom, target.replaceTo, content);
    }
    transform.doc.check();
  } catch { throw new SelectionError('AI_TRANSFORM_MISMATCH', 'Fragment cannot fit the exact target.'); }
  const document = tiptapDocumentSchema.parse(editorJSON(transform.doc.toJSON()));
  if (canonicalJSON(document) === canonicalJSON(editorJSON(doc.toJSON()))) throw new SelectionError('NO_CHANGE', 'No change proposed.');
  return { document, steps: transform.steps };
}
