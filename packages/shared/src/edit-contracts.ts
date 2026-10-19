import { z } from 'zod';
import { idSchema, revisionSchema } from './base-contracts.js';
import { tiptapDocumentSchema, type DocumentNode } from './document.js';

export const editActionSchema = z.enum(['explain', 'simplify', 'expand', 'rewrite', 'example', 'analogy', 'custom']);
export const editModeSchema = z.enum(['replace', 'insert_after']);
export const selectionRequestSchema = z.object({ from: z.number().int().nonnegative(), to: z.number().int().positive(), startBlockId: idSchema, endBlockId: idSchema, sliceHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const editRequestSchema = z.object({ baseRevision: revisionSchema, action: editActionSchema, mode: editModeSchema, instruction: z.string().trim().min(1).max(4000).optional(), target: selectionRequestSchema, retryOfOperationId: idSchema.optional() }).strict().superRefine((input, ctx) => {
  if (input.target.to <= input.target.from) ctx.addIssue({ code: 'custom', message: 'Select nonempty text.' });
  const mode = ['explain', 'example', 'analogy'].includes(input.action) ? 'insert_after' : 'replace';
  if (input.action !== 'custom' && input.mode !== mode) ctx.addIssue({ code: 'custom', message: 'Action/mode mismatch.' });
  if (input.action === 'custom' && !input.instruction) ctx.addIssue({ code: 'custom', message: 'Custom requires instructions.' });
});
export type EditRequest = z.infer<typeof editRequestSchema>;
export type EditAction = z.infer<typeof editActionSchema>;
export type EditMode = z.infer<typeof editModeSchema>;

const editText = z.string().min(1).max(16000).refine(value => value.trim().length > 0 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), 'Use valid nonempty Unicode text.');
export const modelEditOutputSchema = z.object({ fragment: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inline'), text: editText }).strict(),
  z.object({ kind: z.literal('block_texts'), items: z.array(z.object({ text: editText }).strict()).min(1).max(100) }).strict(),
  z.object({ kind: z.literal('insert_blocks'), blocks: z.array(z.object({ type: z.enum(['paragraph', 'example', 'analogy']), text: editText }).strict()).min(1).max(32) }).strict()
]), explanation: z.string().max(2000).optional() }).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= 32768, 'Edit output exceeds 32 KiB.').refine(value => {
  const fragment = value.fragment;
  return (fragment.kind === 'inline' ? fragment.text.length : fragment.kind === 'block_texts' ? fragment.items.reduce((size, item) => size + item.text.length, 0) : fragment.blocks.reduce((size, block) => size + block.text.length, 0)) <= 16000;
}, 'Edit text exceeds 16000 UTF-16 units.');
export const canonicalBlocksSchema = z.array(z.unknown()).min(1).max(100).transform((value, ctx): DocumentNode[] => {
  const result = tiptapDocumentSchema.safeParse({ type: 'doc', content: value });
  if (!result.success) { ctx.addIssue({ code: 'custom', message: 'Invalid canonical fragment.' }); return z.NEVER; }
  return result.data.content;
});
export const selectionTargetSchema = z.object({ version: z.literal(1), baseRevision: revisionSchema, baseHash: z.string().regex(/^[a-f0-9]{64}$/), kind: z.enum(['inline', 'blocks']), from: z.number().int().nonnegative(), to: z.number().int().positive(), replaceFrom: z.number().int().nonnegative(), replaceTo: z.number().int().positive(), startBlockId: idSchema, endBlockId: idSchema, blockIds: z.array(idSchema).min(1).max(100), blocks: canonicalBlocksSchema, text: z.string().min(1).max(12000), sliceHash: z.string().regex(/^[a-f0-9]{64}$/), anchor: z.number().int().positive(), anchorHash: z.string().regex(/^[a-f0-9]{64}$/), targetHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const inlineContentSchema = z.array(z.unknown()).min(1).max(1000).transform((value, ctx): DocumentNode[] => {
  const result = tiptapDocumentSchema.safeParse({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: '11111111-1111-4111-8111-111111111111' }, content: value }] });
  const content = result.success ? result.data.content[0]?.content : undefined;
  if (!content || content.some(node => !['text', 'hardBreak'].includes(node.type))) { ctx.addIssue({ code: 'custom', message: 'Unsupported inline fragment.' }); return z.NEVER; }
  return content;
});
export const preparedEditSchema = z.object({ action: editActionSchema, mode: editModeSchema, target: selectionTargetSchema, fragment: z.discriminatedUnion('kind', [z.object({ kind: z.literal('inline'), content: inlineContentSchema }).strict(), z.object({ kind: z.literal('blocks'), content: canonicalBlocksSchema }).strict()]), formattingChanged: z.boolean(), explanation: z.string().max(2000).optional() }).strict();
export type ModelEditOutput = z.infer<typeof modelEditOutputSchema>;
export type PreparedEdit = z.infer<typeof preparedEditSchema>;

export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJSON(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJSON(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}
