import { describe, expect, it } from 'vitest';
import { chatStartSchema, chatMessageSchema, chatPageQuerySchema, chatModelOutputSchema, chatStartJournalSchema } from './chat-contracts.js';
import { contextManifestSchema, operationResultSchema } from './ai-contracts.js';
import { courseProgressSchema, leafProgressSchema } from './learning-contracts.js';
import { insertionAnchorSchema } from './insertion.js';

const id = '11111111-1111-4111-8111-111111111111';
const start = { baseRevision: 1, message: 'Explain 🧠 é', clientTurnId: id };
describe('chat boundaries and backwards compatibility', () => {
  it('bounds and validates Unicode without normalizing learner text', () => {
    expect(chatStartSchema.parse(start).message).toBe(start.message);
    for (const message of ['', '  ', '\ud800', '\udc00', 'x'.repeat(16001)]) expect(chatStartSchema.safeParse({ ...start, message }).success).toBe(false);
    expect(chatModelOutputSchema.parse({ text: '<script>literal text</script>' }).text).toContain('<script>');
    expect(chatModelOutputSchema.safeParse({ text: 'Answer', assetId: id }).success).toBe(false);
    expect(chatStartSchema.safeParse({ ...start, secret: 'not-accepted' }).success).toBe(false);
    expect(chatStartSchema.safeParse({ ...start, selectedBlockIds: [id, id] }).success).toBe(false);
  });
  it('keeps retries immutable and rejects ambiguous pagination', () => {
    expect(chatStartJournalSchema.parse({ version: 1, lessonId: id, idempotencyKey: id, body: { ...start, retryOfOperationId: id }, createdAt: new Date().toISOString() }).body.retryOfOperationId).toBe(id);
    expect(chatPageQuerySchema.parse({}).limit).toBe(50);
    for (const query of [{ before: id, after: id }, { limit: 101 }, { limit: 0 }, { before: 'arbitrary' }]) expect(chatPageQuerySchema.safeParse(query).success).toBe(false);
  });
  it('requires paired sequences and complete assistant messages', () => {
    const message = { id, lessonId: id, role: 'assistant', content: 'Answer', sequence: 1, turnId: id, operationId: null, status: 'completed', contextRevision: 1, createdAt: new Date().toISOString() };
    expect(chatMessageSchema.parse(message)).toEqual(message);
    for (const patch of [{ status: 'pending' }, { sequence: 2 }, { contextRevision: null }]) expect(chatMessageSchema.safeParse({ ...message, ...patch }).success).toBe(false);
  });
  it('parses historical context and applied results alongside durable chat references', () => {
    expect(contextManifestSchema.parse({ sources: [], omitted: false })).toEqual({ sources: [], omitted: false });
    expect(operationResultSchema.parse({ type: 'applied_lesson', lessonId: id, revision: 1 }).type).toBe('applied_lesson');
    expect(operationResultSchema.parse({ type: 'applied_chat', lessonId: id, turnId: id, messageId: id, contextRevision: 1 }).type).toBe('applied_chat');
  });
  it('keeps insertion isolation local and completion timestamps coherent', () => {
    expect(leafProgressSchema.safeParse({ topicId: id, status: 'completed', completedAt: null, updatedAt: null }).success).toBe(false);
    expect(courseProgressSchema.parse({ treeRevision: 0, completedLeaves: 0, totalLeaves: 0, topics: [] }).totalLeaves).toBe(0);
    expect(courseProgressSchema.safeParse({ treeRevision: 0, completedLeaves: 1, totalLeaves: 0, topics: [] }).success).toBe(false);
    const anchor = { version: 1, lessonId: id, baseRevision: 1, editorInstanceId: id, documentSequence: 0, localSequence: 0, blockId: id, offset: 0, position: 1, documentHash: 'a'.repeat(64), boundaryHash: 'b'.repeat(64), source: { kind: 'chat_insert', sourceId: id, sourceHash: 'c'.repeat(64) } };
    expect(insertionAnchorSchema.parse(anchor).source.kind).toBe('chat_insert');
    expect(insertionAnchorSchema.safeParse({ ...anchor, offset: -1 }).success).toBe(false);
  });
});
