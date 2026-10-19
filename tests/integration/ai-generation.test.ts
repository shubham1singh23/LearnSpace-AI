import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { defaultPreferences } from '@learnspace/shared';
import { ModelError } from '@learnspace/ai';
import { ConfigurationService } from '../../apps/api/src/ai/configuration.js';
import { OperationService } from '../../apps/api/src/ai/operations.js';
import { GenerationService } from '../../apps/api/src/ai/generation.js';
import { createDatabase } from '../../apps/api/src/db.js';
import { parseEnvironment } from '../../apps/api/src/config.js';
import { LessonService, hashJSON } from '../../apps/api/src/workspace/lesson-service.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Separate TEST_DATABASE_URL required.');
const db = createDatabase(url); const courses: string[] = []; const ids: string[] = [];
const original = await db.workspaceSettings.findUnique({ where: { id: 1 } });
const draft = { nodes: [{ tempId: 'root', parentTempId: null, title: 'Foundation', kind: 'module', position: 0, objectives: [] }, { tempId: 'leaf', parentTempId: 'root', title: 'Practice', kind: 'topic', position: 0, objectives: ['Explain a concrete example'] }], prerequisites: [] };
let output: unknown = draft; let calls = 0; let barrier: Promise<void> | undefined;
const configuration = new ConfigurationService(db, parseEnvironment({ DATABASE_URL: url }), () => ({ async generate(_system, _input, schema) { calls++; await barrier; const result = schema.safeParse(output); if (!result.success) throw new ModelError('INVALID_OUTPUT'); return result.data; } }));
const operations = new OperationService(configuration); const generation = new GenerationService(operations);
afterAll(async () => { operations.stop(); await db.lesson.deleteMany({ where: { topic: { courseId: { in: courses } } } }); await db.course.deleteMany({ where: { id: { in: courses } } }); if (original) await db.workspaceSettings.update({ where: { id: 1 }, data: { textConfigId: original.textConfigId } }); await db.aiProviderConfiguration.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect(); });
async function course() {
  const config = await configuration.write({ purpose: 'text', provider: 'ollama', modelId: 'fake-only', options: {}, credential: { source: 'none' } }); ids.push(config.id); await configuration.patchSettings({ textConfigId: config.id });
  const row = await db.course.create({ data: { title: 'Generated course fixture', goal: 'Teach safely', preferences: defaultPreferences } }); courses.push(row.id); return row.id;
}
async function terminal(id: string) { for (let i = 0; i < 100; i++) { const op = await operations.get(id); if (!['pending', 'running'].includes(op.status)) return op; await new Promise(done => setTimeout(done, 10)); } throw new Error('Generation did not complete'); }
it('generates a validated review draft with zero topic or lesson writes and idempotent retries', async () => {
  output = draft; const id = await course(); const key = randomUUID(); const before = calls;
  const start = await generation.syllabus(id, key, { baseTreeRevision: 0 }); const ready = await terminal(start.id); expect(ready.status).toBe('ready'); expect(ready.result).toMatchObject({ type: 'syllabus', draft });
  expect(await db.topic.count({ where: { courseId: id } })).toBe(0); expect(await db.lesson.count({ where: { topic: { courseId: id } } })).toBe(0);
  expect((await generation.syllabus(id, key, { baseTreeRevision: 0 })).id).toBe(start.id); expect(calls - before).toBe(1);
  expect(await db.modelUsage.count({ where: { operationId: start.id } })).toBe(1);
});
it('rejects invalid model output after one repair without saving a partial syllabus', async () => {
  output = { nodes: [], prerequisites: [] }; const id = await course(); const before = calls;
  const start = await generation.syllabus(id, randomUUID(), { baseTreeRevision: 0 }); expect((await terminal(start.id)).status).toBe('failed'); expect(calls - before).toBe(2);
  expect(await db.topic.count({ where: { courseId: id } })).toBe(0); expect(await db.modelUsage.count({ where: { operationId: start.id } })).toBe(2);
});
it('commits reviewed nesting atomically, replays lost acknowledgements and rejects a different draft', async () => {
  output = draft; const id = await course(); const start = await generation.syllabus(id, randomUUID(), { baseTreeRevision: 0 }); await terminal(start.id);
  const reviewed = { ...draft, nodes: [...draft.nodes.map(node => ({ ...node, title: `Reviewed ${node.title}` })), { tempId: 'second', parentTempId: 'root', title: 'Second leaf', kind: 'topic', position: 1, objectives: ['Practice more'] }], prerequisites: [{ topicTempId: 'second', prerequisiteTempId: 'leaf' }] };
  const body = { operationId: start.id, baseTreeRevision: 0, draft: reviewed };
  const [first, second] = await Promise.all([generation.commitSyllabus(id, body), generation.commitSyllabus(id, body)]);
  expect(first).toEqual(second); expect(first.treeRevision).toBe(1); expect(await db.topic.count({ where: { courseId: id } })).toBe(3);
  expect(await db.topicPrerequisite.count({ where: { courseId: id } })).toBe(1);
  expect(await db.lesson.count({ where: { topic: { courseId: id } } })).toBe(0);
  expect((await operations.get(start.id)).status).toBe('applied');
  await expect(generation.commitSyllabus(id, { ...body, draft })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  await db.course.update({ where: { id }, data: { treeRevision: { increment: 1 } } });
  expect(await generation.commitSyllabus(id, body)).toEqual(first);
});
it('stale, cancelled and foreign syllabus commits preserve the existing tree', async () => {
  output = draft; const id = await course(); const start = await generation.syllabus(id, randomUUID(), { baseTreeRevision: 0 }); await terminal(start.id);
  await db.course.update({ where: { id }, data: { treeRevision: 1 } });
  await expect(generation.commitSyllabus(id, { operationId: start.id, baseTreeRevision: 0, draft })).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
  expect(await db.topic.count({ where: { courseId: id } })).toBe(0);
  const other = await course(); await expect(generation.commitSyllabus(other, { operationId: start.id, baseTreeRevision: 0, draft })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await operations.cancel(start.id);
  await expect(generation.commitSyllabus(id, { operationId: start.id, baseTreeRevision: 0, draft })).rejects.toMatchObject({ code: 'OPERATION_NOT_READY' });
});
const lessonOutput = { title: 'Counting', objectives: ['Add numbers'], prerequisiteNotes: [], sections: [{ heading: 'Add groups', blocks: [{ type: 'paragraph', text: 'Count both groups together.' }, { type: 'example', text: 'One apple plus one apple gives two apples.' }] }], recall: [{ question: 'One plus one?', answer: 'Two' }], uncertainties: [] };
async function leaf(courseId: string) { return db.topic.create({ data: { courseId, title: 'Counting', kind: 'topic', position: 0, objectives: ['Add numbers'] } }); }
it('creates one canonical lesson for concurrent explicit requests; reopening and repeated generation make zero model calls', async () => {
  output = lessonOutput; const id = await course(); const topic = await leaf(id); let release!: () => void; barrier = new Promise<void>(done => { release = done; });
  const before = calls;
  const [first, second] = await Promise.all([generation.initial(topic.id, randomUUID(), {}), generation.initial(topic.id, randomUUID(), {})]);
  expect(first.operation?.id).toBe(second.operation?.id); release(); barrier = undefined;
  const completed = await terminal(first.operation!.id); expect(completed.status).toBe('applied'); expect(completed.result?.type).toBe('applied_lesson');
  const saved = await db.lesson.findUniqueOrThrow({ where: { topicId: topic.id } }); expect(saved.source).toBe('initial_ai'); expect(saved.revision).toBe(1);
  const reopened = await generation.initial(topic.id, randomUUID(), {}); expect(reopened.lesson?.id).toBe(saved.id); expect(calls - before).toBe(1);
});
it('manual creation and changed tree context win over delayed initial generation', async () => {
  output = lessonOutput; const id = await course(); const topic = await leaf(id); let release!: () => void; barrier = new Promise<void>(done => { release = done; });
  const started = await generation.initial(topic.id, randomUUID(), {});
  const document = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [{ type: 'text', text: 'Manual notes win' }] }] };
  await db.lesson.create({ data: { topicId: topic.id, document, contentHash: 'a'.repeat(64) } }); release(); barrier = undefined;
  expect((await terminal(started.operation!.id)).errorCode).toBe('LESSON_EXISTS'); expect((await db.lesson.findUniqueOrThrow({ where: { topicId: topic.id } })).document).toEqual(document);
  const other = await course(); const otherTopic = await leaf(other); barrier = new Promise<void>(done => { release = done; });
  const stale = await generation.initial(otherTopic.id, randomUUID(), {}); await db.course.update({ where: { id: other }, data: { treeRevision: 1 } }); release(); barrier = undefined;
  expect((await terminal(stale.operation!.id)).errorCode).toBe('STALE_CONTEXT'); expect(await db.lesson.count({ where: { topicId: otherTopic.id } })).toBe(0);
});
it('regeneration snapshots the prior edited document, applies atomically and replays receipts after later saves', async () => {
  output = lessonOutput; const id = await course(); const topic = await leaf(id); const lessons = new LessonService(db);
  const originalDocument = { type: 'doc' as const, content: [{ type: 'paragraph' as const, attrs: { blockId: randomUUID() }, content: [{ type: 'text' as const, text: 'My custom edited notes' }] }] };
  const lesson = await lessons.create(topic.id, { mutationId: randomUUID(), documentSchemaVersion: 1, document: originalDocument });
  const started = await generation.regenerate(lesson.id, randomUUID(), { baseRevision: 1, instruction: 'Use a concrete example' });
  const ready = await terminal(started.id); expect(ready.status).toBe('ready'); expect(ready.context.sources[0]).toMatchObject({ lessonId: lesson.id, revision: 1 });
  expect((await lessons.load(topic.id)).document).toEqual(originalDocument);
  const body = { operationId: started.id, baseRevision: 1, mutationId: randomUUID(), confirmReplace: true };
  const [first, second] = await Promise.all([generation.commitRegeneration(lesson.id, body), generation.commitRegeneration(lesson.id, body)]); expect(first).toEqual(second); expect(first.revision).toBe(2);
  const saved = await db.lesson.findUniqueOrThrow({ where: { id: lesson.id } }); expect(saved.source).toBe('regenerate'); expect(saved.operationId).toBe(started.id); expect(saved.contentHash).toBe(hashJSON(saved.document));
  expect((await lessons.version(lesson.id, 1)).document).toEqual(originalDocument); expect((await operations.get(started.id)).status).toBe('applied');
  await lessons.save(lesson.id, { baseRevision: 2, mutationId: randomUUID(), documentSchemaVersion: 1, document: originalDocument }); expect((await lessons.load(topic.id)).revision).toBe(3);
  expect(await generation.commitRegeneration(lesson.id, body)).toEqual(first); expect((await lessons.load(topic.id)).revision).toBe(3);
});
it('editing while regeneration runs and cancellation both prevent replacement', async () => {
  output = lessonOutput; const id = await course(); const topic = await leaf(id); const lessons = new LessonService(db);
  const document = { type: 'doc' as const, content: [{ type: 'paragraph' as const, attrs: { blockId: randomUUID() }, content: [] }] };
  const lesson = await lessons.create(topic.id, { mutationId: randomUUID(), documentSchemaVersion: 1, document });
  let release!: () => void; barrier = new Promise<void>(done => { release = done; });
  const started = await generation.regenerate(lesson.id, randomUUID(), { baseRevision: 1 });
  const edited = { ...document, content: [{ ...document.content[0]!, content: [{ type: 'text' as const, text: 'A newer saved edit' }] }] };
  await lessons.save(lesson.id, { baseRevision: 1, mutationId: randomUUID(), documentSchemaVersion: 1, document: edited }); release(); barrier = undefined; await terminal(started.id);
  await expect(generation.commitRegeneration(lesson.id, { operationId: started.id, baseRevision: 1, mutationId: randomUUID(), confirmReplace: true })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' }); expect((await lessons.load(topic.id)).document).toEqual(edited);
  const cancelled = await generation.regenerate(lesson.id, randomUUID(), { baseRevision: 2 }); await terminal(cancelled.id); await operations.cancel(cancelled.id);
  await expect(generation.commitRegeneration(lesson.id, { operationId: cancelled.id, baseRevision: 2, mutationId: randomUUID(), confirmReplace: true })).rejects.toMatchObject({ code: 'OPERATION_NOT_READY' }); expect((await lessons.load(topic.id)).revision).toBe(2);
});
