import { expect, it } from 'vitest';
import { educationalLessonSchema, providerInputSchema, syllabusDraftSchema } from './ai-contracts.js';

it('checks syllabus ownership, ordering, cycles and teaching objectives', () => {
  const node = { tempId: 'a', parentTempId: null, title: 'A', kind: 'topic', position: 0, objectives: ['Understand A'] };
  expect(syllabusDraftSchema.safeParse({ nodes: [node], prerequisites: [] }).success).toBe(true);
  for (const invalid of [
    { nodes: [{ ...node, parentTempId: 'missing' }], prerequisites: [] },
    { nodes: [{ ...node, position: 1 }], prerequisites: [] },
    { nodes: [{ ...node, objectives: [] }], prerequisites: [] },
    { nodes: [node], prerequisites: [{ topicTempId: 'a', prerequisiteTempId: 'a' }] },
    { nodes: [{ ...node, parentTempId: 'a' }], prerequisites: [] }
  ]) expect(syllabusDraftSchema.safeParse(invalid).success).toBe(false);
});
it('requires a worked example, rectangular tables, and supported teaching shapes', () => {
  const lesson = { title: 'A', objectives: ['Learn A'], prerequisiteNotes: [], sections: [{ heading: 'A', blocks: [{ type: 'example', text: 'One plus one is two.' }] }], recall: [{ question: 'One plus one?', answer: 'Two' }], uncertainties: [] };
  expect(educationalLessonSchema.safeParse(lesson).success).toBe(true);
  expect(educationalLessonSchema.safeParse({ ...lesson, sections: [{ heading: 'A', blocks: [{ type: 'paragraph', text: 'No example' }] }] }).success).toBe(false);
  expect(educationalLessonSchema.safeParse({ ...lesson, sections: [{ heading: 'A', blocks: [...lesson.sections[0]!.blocks, { type: 'table', headers: ['A'], rows: [['A', 'B']] }] }] }).success).toBe(false);
});
it('rejects unapproved provider options and persistent credential fields', () => {
  const config = { purpose: 'text', provider: 'openai', modelId: 'test', options: {}, credential: { source: 'session', secret: 'test-only' } };
  expect(providerInputSchema.safeParse(config).success).toBe(true);
  expect(providerInputSchema.safeParse({ ...config, apiKey: 'forbidden' }).success).toBe(false);
  expect(providerInputSchema.safeParse({ ...config, options: { tracing: true } }).success).toBe(false);
});
