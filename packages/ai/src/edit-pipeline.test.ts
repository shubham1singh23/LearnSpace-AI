import { expect, it } from 'vitest';
import { captureSelection, selectionRequest, editRequestSchema, editorJSON, editorSchema, modelEditOutputSchema, transformEdit, type TiptapDocument } from '@learnspace/shared';
import { compileEdit } from './edit-pipeline.js';
const id = '11111111-1111-4111-8111-111111111111'; const other = '22222222-2222-4222-8222-222222222222';
const doc: TiptapDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: id, learningRole: 'reflection', learningGroupId: other }, content: [{ type: 'text', text: 'Hello ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'world', marks: [{ type: 'italic' }] }] }, { type: 'paragraph', attrs: { blockId: other }, content: [{ type: 'text', text: 'Untouched' }] }] };
for (const action of ['explain', 'simplify', 'expand', 'rewrite', 'example', 'analogy', 'custom'] as const) it(`${action} compiles and transforms only its exact target`, async () => {
  const target = await captureSelection(doc, 1, 1, 6); const mode = ['explain', 'example', 'analogy'].includes(action) ? 'insert_after' : 'replace';
  const request = editRequestSchema.parse({ baseRevision: 1, action, mode, instruction: 'Improve', target: selectionRequest(target) });
  const output = modelEditOutputSchema.parse({ fragment: mode === 'replace' ? { kind: 'inline', text: 'Better' } : { kind: 'insert_blocks', blocks: [{ type: action === 'example' || action === 'analogy' ? action : 'paragraph', text: 'Helpful addition' }] } });
  const prepared = compileEdit(request, target, output); const result = await transformEdit(doc, prepared);
  expect(result.document.content.at(-1)).toEqual(doc.content.at(-1));
  if (mode === 'replace') { expect(result.document.content[0]?.attrs).toEqual(doc.content[0]?.attrs); expect(result.document.content[0]?.content?.[0]?.marks).toEqual([{ type: 'bold' }]); expect(result.document.content[0]?.content?.at(-1)).toEqual(doc.content[0]?.content?.at(-1)); }
  else expect(result.document.content[0]).toEqual(doc.content[0]);
  let trDoc = editorSchema.nodeFromJSON(doc); for (const step of result.steps) { const applied = step.apply(trDoc); if (!applied.doc) throw new Error('Step failed'); trDoc = applied.doc; }
  expect(editorJSON(trDoc.toJSON())).toEqual(result.document);
});
it('discloses mixed formatting, retains complete block shells and rejects forged metadata', async () => {
  const target = await captureSelection(doc, 1, 0, 13); const request = editRequestSchema.parse({ baseRevision: 1, action: 'rewrite', mode: 'replace', target: selectionRequest(target) });
  const prepared = compileEdit(request, target, { fragment: { kind: 'block_texts', items: [{ text: 'Rewritten' }] } });
  expect(prepared.formattingChanged).toBe(true); expect((await transformEdit(doc, prepared)).document.content[0]?.attrs).toEqual(doc.content[0]?.attrs);
  prepared.fragment.content[0]!.attrs = { blockId: other };
  await expect(transformEdit(doc, prepared)).rejects.toThrow();
});
it('rejects model metadata, invalid Unicode, wrong fragment shapes and no changes', async () => {
  expect(modelEditOutputSchema.safeParse({ fragment: { kind: 'inline', text: 'ok', attrs: { blockId: id } } }).success).toBe(false);
  expect(modelEditOutputSchema.safeParse({ fragment: { kind: 'inline', text: '\ud800' } }).success).toBe(false);
  expect(modelEditOutputSchema.safeParse({ fragment: { kind: 'block_texts', items: [{ text: 'a'.repeat(9000) }, { text: 'b'.repeat(9000) }] } }).success).toBe(false);
  const target = await captureSelection(doc, 1, 1, 6); const request = editRequestSchema.parse({ baseRevision: 1, action: 'rewrite', mode: 'replace', target: selectionRequest(target) });
  const unchanged = compileEdit(request, target, { fragment: { kind: 'inline', text: 'Hello' } });
  await expect(transformEdit(doc, unchanged)).rejects.toMatchObject({ code: 'NO_CHANGE' });
});
it('compiles nested text, common links and inert malicious-looking text without touching container identity', async () => {
  const nested: TiptapDocument = { type: 'doc', content: [{ type: 'blockquote', attrs: { blockId: other }, content: [{ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text: 'Nested text', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com/' } }] }] }] }] };
  const target = await captureSelection(nested, 3, 2, 8); const request = editRequestSchema.parse({ baseRevision: 3, action: 'custom', mode: 'replace', instruction: 'Rewrite', target: selectionRequest(target) });
  const prepared = compileEdit(request, target, { fragment: { kind: 'inline', text: '<script>alert(1)</script>' } }); const result = await transformEdit(nested, prepared);
  expect(result.document.content[0]?.attrs).toEqual(nested.content[0]?.attrs); expect(result.document.content[0]?.content?.[0]?.attrs).toEqual(nested.content[0]?.content?.[0]?.attrs);
  expect(result.document.content[0]?.content?.[0]?.content?.[0]?.marks).toEqual(nested.content[0]?.content?.[0]?.content?.[0]?.marks);
});
