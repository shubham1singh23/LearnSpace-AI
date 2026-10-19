import { z } from 'zod';
import { idSchema, revisionSchema } from './base-contracts.js';
import { chatTextSchema } from './chat-contracts.js';
import { canonicalJSON, fingerprint } from './edit-contracts.js';
import { editorJSON, editorSchema, tiptapDocumentSchema, type TiptapDocument } from './document.js';
import { textFragment } from './edit-transform.js';
import { Fragment } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const insertionIsolationSchema = z.object({ kind: z.enum(['chat_insert', 'recall_insert']), sourceId: idSchema.optional(), sourceHash: hash }).strict();
export const insertionAnchorSchema = z.object({ version: z.literal(1), lessonId: idSchema, baseRevision: revisionSchema, editorInstanceId: idSchema, documentSequence: z.number().int().nonnegative(), localSequence: z.number().int().nonnegative(), blockId: idSchema, offset: z.number().int().nonnegative(), position: z.number().int().positive(), documentHash: hash, boundaryHash: hash, source: insertionIsolationSchema }).strict();
export type InsertionIsolation = z.infer<typeof insertionIsolationSchema>;
export type InsertionAnchor = z.infer<typeof insertionAnchorSchema>;

export async function captureInsertion(input: TiptapDocument, position: number, metadata: Omit<InsertionAnchor, 'version' | 'position' | 'blockId' | 'offset' | 'documentHash' | 'boundaryHash'>): Promise<InsertionAnchor> {
  const source = tiptapDocumentSchema.parse(input); const doc = editorSchema.nodeFromJSON(source);
  if (!Number.isInteger(position) || position < 1 || position >= doc.content.size) throw new Error('Place a collapsed cursor inside a paragraph or heading.');
  const resolved = doc.resolve(position); const parent = resolved.parent;
  if (!['paragraph', 'heading'].includes(parent.type.name) || typeof parent.attrs.blockId !== 'string') throw new Error('Place a collapsed cursor inside a paragraph or heading.');
  const offset = resolved.parentOffset;
  const boundary = parent.textBetween(Math.max(0, offset - 1), Math.min(parent.content.size, offset + 1), '', '\ufffc');
  if (offset > 0 && offset < parent.content.size && /^[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(boundary)) throw new Error('Cursor splits a Unicode surrogate pair.');
  return insertionAnchorSchema.parse({ ...metadata, version: 1, position, blockId: parent.attrs.blockId, offset, documentHash: await fingerprint(source), boundaryHash: await fingerprint({ block: parent.toJSON(), offset, position }) });
}
export async function transformInsertion(input: TiptapDocument, raw: InsertionAnchor, rawText: string) {
  const anchor = insertionAnchorSchema.parse(raw); const text = chatTextSchema.parse(rawText);
  if (await fingerprint(text) !== anchor.source.sourceHash) throw new Error('Insertion source changed.');
  const recaptured = await captureInsertion(input, anchor.position, anchor);
  if (canonicalJSON(recaptured) !== canonicalJSON(anchor)) throw new Error('Insertion anchor is stale.');
  const doc = editorSchema.nodeFromJSON(tiptapDocumentSchema.parse(input)); const transform = new Transform(doc);
  transform.insert(anchor.position, Fragment.fromArray(textFragment(text).map(node => editorSchema.nodeFromJSON(node)))); transform.doc.check();
  return { document: tiptapDocumentSchema.parse(editorJSON(transform.doc.toJSON())), steps: transform.steps };
}
