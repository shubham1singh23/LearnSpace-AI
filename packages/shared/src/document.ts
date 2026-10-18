import { z } from 'zod';

const id = z.uuid();
const learning = { learningRole: z.enum(['reflection', 'recall_question', 'recall_answer']).optional(), learningGroupId: id.optional() };
const block = { blockId: id };
const safeHref = z.string().max(2048).refine(value => /^(https?:\/\/|mailto:)/i.test(value), 'Unsupported link protocol');
const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['bold', 'italic', 'strike', 'underline', 'code']) }).strict(),
  z.object({ type: z.literal('link'), attrs: z.object({ href: safeHref }).strict() }).strict()
]);

export interface DocumentMark { type: 'bold' | 'italic' | 'strike' | 'underline' | 'code' | 'link'; attrs?: { href: string } }
export type DocumentNodeType = 'doc' | 'text' | 'paragraph' | 'heading' | 'hardBreak' | 'bulletList' | 'orderedList' | 'listItem' | 'blockquote' | 'horizontalRule' | 'codeBlock' | 'table' | 'tableRow' | 'tableHeader' | 'tableCell' | 'mathInline' | 'mathBlock' | 'exampleBlock' | 'analogyBlock' | 'image';
export interface DocumentNode {
  type: DocumentNodeType;
  attrs?: Record<string, string | number | boolean | null>;
  text?: string;
  marks?: DocumentMark[];
  content?: DocumentNode[];
}
export interface TiptapDocument extends DocumentNode { type: 'doc'; content: DocumentNode[] }

const attrs = {
  paragraph: z.object({ ...block, ...learning }).strict(),
  heading: z.object({ ...block, ...learning, level: z.number().int().min(1).max(6) }).strict(),
  orderedList: z.object({ ...block, start: z.number().int().min(1).optional() }).strict(),
  codeBlock: z.object({ ...block, language: z.string().regex(/^[\w+-]{0,40}$/).nullable().optional() }).strict(),
  mathInline: z.object({ latex: z.string().min(1).max(8000) }).strict(),
  mathBlock: z.object({ ...block, latex: z.string().min(1).max(8000) }).strict(),
  exampleBlock: z.object({ ...block, label: z.string().max(240).optional() }).strict(),
  analogyBlock: z.object({ ...block, label: z.string().max(240).optional() }).strict(),
  image: z.object({ ...block, assetId: id, alt: z.string().max(1000), caption: z.string().max(2000).optional(), width: z.number().int().positive().max(25000), height: z.number().int().positive().max(25000) }).strict()
};
const inline = new Set(['text', 'hardBreak', 'mathInline']);
const blocks = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule', 'codeBlock', 'table', 'mathBlock', 'exampleBlock', 'analogyBlock', 'image']);
const leaves = new Set(['text', 'hardBreak', 'horizontalRule', 'mathInline', 'mathBlock', 'image']);

const nodeSchema: z.ZodType<DocumentNode> = z.lazy(() => z.object({
  type: z.enum(['doc', 'text', 'paragraph', 'heading', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'horizontalRule', 'codeBlock', 'table', 'tableRow', 'tableHeader', 'tableCell', 'mathInline', 'mathBlock', 'exampleBlock', 'analogyBlock', 'image']),
  attrs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  text: z.string().min(1).optional(), marks: z.array(markSchema).max(6).optional(), content: z.array(nodeSchema).optional()
}).strict().superRefine((node, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (node.type === 'text') {
    if (!node.text || node.attrs || node.content) fail('Invalid text node');
  } else if (node.text !== undefined || node.marks !== undefined) fail('Only text nodes carry text or marks');
  if (node.type === 'doc' || node.type === 'text' || node.type === 'hardBreak') {
    if (node.attrs !== undefined) fail('Unexpected attributes');
  } else {
    const schema = attrs[node.type as keyof typeof attrs] ?? z.object(block).strict();
    if (!schema.safeParse(node.attrs).success) fail(`Invalid ${node.type} attributes`);
  }
  if (leaves.has(node.type) && node.content !== undefined) fail('Leaf node cannot contain children');
  if (!leaves.has(node.type) && !node.content) fail('Container content is required');
  const children = node.content ?? [];
  let allowed: Set<string> | undefined;
  if (node.type === 'paragraph' || node.type === 'heading') allowed = inline;
  else if (node.type === 'codeBlock') allowed = new Set(['text']);
  else if (node.type === 'bulletList' || node.type === 'orderedList') allowed = new Set(['listItem']);
  else if (node.type === 'table') allowed = new Set(['tableRow']);
  else if (node.type === 'tableRow') allowed = new Set(['tableCell', 'tableHeader']);
  else if (!leaves.has(node.type)) allowed = blocks;
  if (allowed && children.some(child => !allowed.has(child.type))) fail('Invalid child node type');
  if (!leaves.has(node.type) && node.type !== 'paragraph' && node.type !== 'heading' && node.type !== 'codeBlock' && children.length === 0) fail('Container cannot be empty');
  if (node.type === 'codeBlock' && children.some(child => child.marks?.length)) fail('Code cannot contain rich marks');
  if (node.type === 'listItem' && children[0]?.type !== 'paragraph') fail('List item must start with paragraph');
  if (node.type === 'table' && children.length > 200) fail('Too many table rows');
  if (node.type === 'tableRow' && children.length > 50) fail('Too many table columns');
}));

// Resource checks run before recursive parsing to avoid deeply nested untrusted JSON.
export const tiptapDocumentSchema = z.unknown().transform((input, ctx): TiptapDocument => {
  const fail = (message: string): never => { ctx.addIssue({ code: 'custom', message }); return z.NEVER; };
  const stack: { value: unknown; depth: number }[] = [{ value: input, depth: 0 }];
  let count = 0;
  const ids = new Set<string>();
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    if (++count > 20000 || entry.depth > 128) return fail('Document exceeds structural limits');
    if (entry.value && typeof entry.value === 'object') {
      const node = entry.value as Record<string, unknown>;
      const nodeAttrs = node.attrs as Record<string, unknown> | undefined;
      if (typeof nodeAttrs?.blockId === 'string') {
        if (ids.has(nodeAttrs.blockId)) return fail('Duplicate block ID');
        ids.add(nodeAttrs.blockId);
      }
      if (Array.isArray(node.content)) for (const child of node.content) stack.push({ value: child, depth: entry.depth + 1 });
    }
  }
  try { if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 2 * 1024 * 1024) return fail('Document exceeds size limit'); }
  catch { return fail('Document must be serializable JSON'); }
  const result = nodeSchema.safeParse(input);
  if (!result.success || result.data.type !== 'doc' || !result.data.content) return fail('Invalid Tiptap document structure');
  return result.data as TiptapDocument;
});
