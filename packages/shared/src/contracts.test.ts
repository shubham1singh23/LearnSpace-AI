import { describe, expect, it } from 'vitest';
import { courseSchema, defaultPreferences, healthResponseSchema, saveLessonSchema, tiptapDocumentSchema, topicSchema } from './index.js';

const first = 'a8000000-0000-4000-8000-000000000001';
const second = 'a8000000-0000-4000-8000-000000000002';
const document = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: first }, content: [{ type: 'text', text: 'My edited explanation.', marks: [{ type: 'bold' }] }] }] };

describe('shared persistence contracts', () => {
  it('round-trips editable JSON instead of accepting Markdown', () => {
    expect(tiptapDocumentSchema.parse(document)).toEqual(document);
    expect(tiptapDocumentSchema.safeParse('# Notes').success).toBe(false);
    expect(tiptapDocumentSchema.safeParse({ type: 'doc', content: [{ type: 'html', text: '<script>bad()</script>' }] }).success).toBe(false);
  });
  it('rejects duplicate block IDs and malformed nesting', () => {
    expect(tiptapDocumentSchema.safeParse({ ...document, content: [...document.content, ...document.content] }).success).toBe(false);
    expect(tiptapDocumentSchema.safeParse({ type: 'doc', content: [{ type: 'text', text: 'Not a block' }] }).success).toBe(false);
  });
  it('rejects unknown attributes and unsafe links', () => {
    expect(tiptapDocumentSchema.safeParse({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: first, onclick: 'bad' }, content: [] }] }).success).toBe(false);
    expect(tiptapDocumentSchema.safeParse({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: first }, content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }).success).toBe(false);
  });
  it('preserves learning role attrs and asset references', () => {
    const rich = { type: 'doc', content: [
      { type: 'paragraph', attrs: { blockId: first, learningRole: 'recall_question', learningGroupId: second }, content: [] },
      { type: 'image', attrs: { blockId: second, assetId: first, alt: 'Diagram', width: 100, height: 80 } }
    ] };
    expect(tiptapDocumentSchema.parse(rich)).toEqual(rich);
  });
  it('bounds recursion before parsing deeply nested documents', () => {
    let value: unknown = { type: 'paragraph', attrs: { blockId: first }, content: [] };
    for (let i = 0; i < 130; i++) value = { type: 'blockquote', attrs: { blockId: crypto.randomUUID() }, content: [value] };
    expect(tiptapDocumentSchema.safeParse({ type: 'doc', content: [value] }).success).toBe(false);
  });
  it('requires positive lesson revisions and excludes simultaneous AI operations', () => {
    const base = { baseRevision: 1, mutationId: second, documentSchemaVersion: 1, document };
    expect(saveLessonSchema.parse(base).document).toEqual(document);
    expect(saveLessonSchema.safeParse({ ...base, baseRevision: 0 }).success).toBe(false);
    expect(saveLessonSchema.safeParse({ ...base, aiOperationId: first, imageOperationId: second }).success).toBe(false);
  });
  it('accepts initial zero tree revision and rejects extra secret fields', () => {
    const course = { id: first, title: 'My course', goal: 'Learn SQL', preferences: defaultPreferences, treeRevision: 0, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' };
    expect(courseSchema.parse(course).treeRevision).toBe(0);
    expect(courseSchema.safeParse({ ...course, apiKey: 'should-not-be-here' }).success).toBe(false);
    expect(topicSchema.safeParse({ id: first, courseId: second, parentId: null, title: 'Topic', kind: 'topic', position: -1, objectives: [], isLeaf: true }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ data: { status: 'ok', service: 'learnspace-api', database: 'ready', storage: 'ready', key: 'secret' }, requestId: first }).success).toBe(false);
  });
});
