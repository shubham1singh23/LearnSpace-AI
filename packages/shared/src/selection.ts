import type { Node as PMNode } from '@tiptap/pm/model';
import { editorJSON, editorSchema, tiptapDocumentSchema, type DocumentNode, type TiptapDocument } from './document.js';
import { fingerprint, type EditRequest } from './edit-contracts.js';

export class SelectionError extends Error {
  constructor(readonly code: 'UNSUPPORTED_SELECTION' | 'TARGET_MISMATCH' | 'AI_TRANSFORM_MISMATCH' | 'NO_CHANGE', message: string) { super(message); }
}
export interface SelectionTarget {
  version: 1; baseRevision: number; baseHash: string; kind: 'inline' | 'blocks';
  from: number; to: number; replaceFrom: number; replaceTo: number;
  startBlockId: string; endBlockId: string; blockIds: string[];
  blocks: DocumentNode[]; text: string; sliceHash: string; anchor: number; anchorHash: string; targetHash: string;
}
export const selectionRequest = (target: SelectionTarget): EditRequest['target'] => ({ from: target.from, to: target.to, startBlockId: target.startBlockId, endBlockId: target.endBlockId, sliceHash: target.sliceHash });
function validBoundary(doc: PMNode, pos: number) {
  const resolved = doc.resolve(pos);
  if (!resolved.parent.isTextblock || resolved.parentOffset === 0 || resolved.parentOffset === resolved.parent.content.size) return true;
  const pair = resolved.parent.textBetween(resolved.parentOffset - 1, resolved.parentOffset + 1, '', '\ufffc');
  return !(pair.length === 2 && /[\uD800-\uDBFF]/.test(pair[0]!) && /[\uDC00-\uDFFF]/.test(pair[1]!));
}
export async function captureSelection(input: TiptapDocument, baseRevision: number, from: number, to: number): Promise<SelectionTarget> {
  const source = tiptapDocumentSchema.parse(input); const doc = editorSchema.nodeFromJSON(source);
  const fail = (message: string): never => { throw new SelectionError('UNSUPPORTED_SELECTION', message); };
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > doc.content.size) fail('Select nonempty paragraph or heading text.');
  if (!validBoundary(doc, from) || !validBoundary(doc, to)) fail('Selection splits a Unicode surrogate pair.');
  const eligible: { node: PMNode; pos: number; parent: PMNode }[] = [];
  doc.descendants((node, pos, parent) => { if ((node.type.name === 'paragraph' || node.type.name === 'heading') && parent) eligible.push({ node, pos, parent }); });
  const inside = eligible.find(entry => from >= entry.pos + 1 && to <= entry.pos + entry.node.nodeSize - 1);
  let chosen = inside ? [inside] : eligible.filter(entry => entry.pos >= from - 1 && entry.pos + entry.node.nodeSize <= to + 1);
  if (!chosen.length || chosen.length > 100) fail('Select at most 100 complete contiguous text blocks.');
  const first = chosen[0]!; const last = chosen.at(-1)!;
  if (!inside) {
    if (!((from === first.pos && to === last.pos + last.node.nodeSize) || (from === first.pos + 1 && to === last.pos + last.node.nodeSize - 1))) fail('Multi-block selections must include complete text blocks.');
    if (chosen.some((entry, index) => entry.parent !== first.parent || index > 0 && chosen[index - 1]!.pos + chosen[index - 1]!.node.nodeSize !== entry.pos)) fail('Do not cross list, table or container boundaries.');
  }
  let unsupported = false; const slice = doc.slice(from, to);
  slice.content.descendants(node => { if (!['text', 'hardBreak', 'paragraph', 'heading'].includes(node.type.name)) unsupported = true; });
  if (unsupported) fail('Selections containing structural nodes or atoms are unsupported.');
  const text = doc.textBetween(from, to, '\n', '\n');
  if (!text.trim() || text.length > 12000) fail('Select between 1 and 12000 UTF-16 text units.');
  // Parse selected shells through the canonical document validator; IDs/metadata are never model supplied.
  chosen = [...chosen];
  const blocks = tiptapDocumentSchema.parse(editorJSON({ type: 'doc', content: chosen.map(entry => entry.node.toJSON()) })).content;
  const blockIds = blocks.map(block => String(block.attrs?.blockId));
  const anchor = last.pos + last.node.nodeSize;
  const anchorHash = await fingerprint({ blockId: blockIds.at(-1), parent: first.parent.type.name, anchor, next: doc.nodeAt(anchor)?.toJSON() ?? null });
  const descriptor = { version: 1 as const, baseRevision, baseHash: await fingerprint(source), kind: inside ? 'inline' as const : 'blocks' as const, from, to, replaceFrom: inside ? from : first.pos, replaceTo: inside ? to : anchor, startBlockId: blockIds[0]!, endBlockId: blockIds.at(-1)!, blockIds, blocks, text, sliceHash: await fingerprint({ content: slice.content.toJSON(), openStart: slice.openStart, openEnd: slice.openEnd }), anchor, anchorHash };
  return { ...descriptor, targetHash: await fingerprint(descriptor) };
}
