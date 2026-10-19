import { randomUUID } from 'node:crypto';
import { allNodesFixture, block } from '../../../tests/fixtures/document.js';
const paragraph = () => ({ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [] });
import { describe, expect, it } from 'vitest';
import { conflictSchema, createLessonSchema, editorJSON, editorSchema, receiptSchema, restoreLessonSchema, tiptapDocumentSchema } from './index.js';

describe('Phase 1 compatibility gate', () => {
  it('round-trips every supported node, mark, learning attribute and image through the headless editor', () => {
    const fixture = allNodesFixture();
    const validated = tiptapDocumentSchema.parse(fixture);
    const serialized = editorJSON(editorSchema.nodeFromJSON(validated).toJSON());
    expect(tiptapDocumentSchema.parse(serialized)).toEqual(fixture);
  });
  it('accepts empty notes as a paragraph and rejects an empty document root', () => {
    const document = { type: 'doc', content: [paragraph()] };
    expect(tiptapDocumentSchema.parse(editorJSON(editorSchema.nodeFromJSON(document).toJSON()))).toEqual(document);
    expect(tiptapDocumentSchema.safeParse({ type: 'doc', content: [] }).success).toBe(false);
    expect(createLessonSchema.parse({ mutationId: randomUUID(), documentSchemaVersion: 1, document }).document).toEqual(document);
  });
  it('rejects merged/ragged tables, duplicate marks and incompatible code marks', () => {
    const cell = () => block('tableCell', [paragraph()]);
    for (const content of [
      [block('table', [block('tableRow', [cell()]), block('tableRow', [cell(), cell()])])],
      [block('table', [block('tableRow', [{ ...cell(), attrs: { blockId: randomUUID(), colspan: 2 } }])])],
      [block('paragraph', [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] }])],
      [block('paragraph', [{ type: 'text', text: 'x', marks: [{ type: 'code' }, { type: 'italic' }] }])]
    ]) expect(tiptapDocumentSchema.safeParse({ type: 'doc', content }).success).toBe(false);
  });
  it('validates replay receipts, restore confirmation and stale revision details', () => {
    const receipt = { id: randomUUID(), mutationId: randomUUID(), revision: 2, updatedAt: new Date().toISOString(), contentHash: 'a'.repeat(64) };
    expect(receiptSchema.parse(receipt)).toEqual(receipt);
    expect(receiptSchema.safeParse({ ...receipt, revision: 0 }).success).toBe(false);
    expect(conflictSchema.parse({ code: 'REVISION_CONFLICT', message: 'Changed', retryable: false, details: { currentRevision: 2 } }).details.currentRevision).toBe(2);
    expect(restoreLessonSchema.safeParse({ sourceRevision: 1, baseRevision: 2, mutationId: randomUUID(), confirm: false }).success).toBe(false);
  });
});

