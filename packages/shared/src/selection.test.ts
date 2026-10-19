import { expect, it } from 'vitest';
import { captureSelection } from './selection.js';
import { editRequestSchema } from './edit-contracts.js';
import { editorSchema, type TiptapDocument } from './document.js';
const a = '11111111-1111-4111-8111-111111111111'; const b = '22222222-2222-4222-8222-222222222222';
const doc: TiptapDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: a }, content: [{ type: 'text', text: 'A🙂B' }] }, { type: 'heading', attrs: { blockId: b, level: 2 }, content: [{ type: 'text', text: 'Next' }] }] };
it('binds exact UTF-16 ranges, slice openness, block identity and insertion boundaries', async () => {
  const target = await captureSelection(doc, 1, 2, 4); expect(target.text).toBe('🙂'); expect(target.kind).toBe('inline'); expect(target.blockIds).toEqual([a]); expect(target.anchor).toBe(6);
  expect(await captureSelection(doc, 1, 2, 4)).toEqual(target);
  expect((await captureSelection(doc, 2, 2, 4)).targetHash).not.toBe(target.targetHash);
  await expect(captureSelection(doc, 1, 2, 3)).rejects.toMatchObject({ code: 'UNSUPPORTED_SELECTION' });
});
it('accepts whole contiguous text blocks but rejects partial cross-block selections', async () => {
  expect((await captureSelection(doc, 1, 0, 12)).kind).toBe('blocks');
  expect((await captureSelection(doc, 1, 1, 11)).blockIds).toEqual([a, b]);
  await expect(captureSelection(doc, 1, 2, 10)).rejects.toThrow();
  await expect(captureSelection(doc, 1, 1, 1)).rejects.toThrow();
});
it('supports safe nested text while rejecting structural and atom selections', async () => {
  const nested: TiptapDocument = { type: 'doc', content: [{ type: 'blockquote', attrs: { blockId: b }, content: [doc.content[0]!] }] };
  expect((await captureSelection(nested, 1, 2, 6)).text).toBe('A🙂B');
  await expect(captureSelection(nested, 1, 0, 8)).rejects.toThrow();
  const math: TiptapDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: a }, content: [{ type: 'mathInline', attrs: { latex: 'x' } }] }] };
  await expect(captureSelection(math, 1, 1, 2)).rejects.toThrow();
});
it('validates all action/mode pairs and explicit custom instructions', () => {
  const target = { from: 1, to: 2, startBlockId: a, endBlockId: a, sliceHash: 'a'.repeat(64) };
  for (const action of ['explain', 'simplify', 'expand', 'rewrite', 'example', 'analogy', 'custom']) {
    const mode = ['explain', 'example', 'analogy'].includes(action) ? 'insert_after' : 'replace';
    expect(editRequestSchema.safeParse({ baseRevision: 1, action, mode, target, instruction: 'Teach this' }).success).toBe(true);
  }
  expect(editRequestSchema.safeParse({ baseRevision: 1, action: 'custom', mode: 'replace', target }).success).toBe(false);
});
it('supports text inside list items and cells but refuses crossing their structural boundaries', async () => {
  const id = () => crypto.randomUUID();
  for (const container of ['list', 'table'] as const) {
    const paragraphs = [doc.content[0]!, { type: 'paragraph' as const, attrs: { blockId: b }, content: doc.content[1]!.content }];
    const nested: TiptapDocument = { type: 'doc', content: [container === 'list' ? { type: 'bulletList', attrs: { blockId: id() }, content: paragraphs.map(node => ({ type: 'listItem', attrs: { blockId: id() }, content: [node] })) } : { type: 'table', attrs: { blockId: id() }, content: [{ type: 'tableRow', attrs: { blockId: id() }, content: paragraphs.map(node => ({ type: 'tableCell', attrs: { blockId: id() }, content: [node] })) }] }] };
    const ranges: { from: number; to: number }[] = [];
    editorSchema.nodeFromJSON(nested).descendants((node, pos) => { if (['paragraph', 'heading'].includes(node.type.name)) ranges.push({ from: pos + 1, to: pos + node.nodeSize - 1 }); });
    expect((await captureSelection(nested, 1, ranges[0]!.from, ranges[0]!.to)).text).toBe('A🙂B');
    await expect(captureSelection(nested, 1, ranges[0]!.from, ranges[1]!.to)).rejects.toThrow();
  }
  const code: TiptapDocument = { type: 'doc', content: [{ type: 'codeBlock', attrs: { blockId: a }, content: [{ type: 'text', text: 'unsafe structural edit' }] }] };
  await expect(captureSelection(code, 1, 1, 7)).rejects.toThrow();
  await expect(captureSelection({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: a }, content: [{ type: 'text', text: 'x'.repeat(12001) }] }] }, 1, 1, 12002)).rejects.toThrow();
});
