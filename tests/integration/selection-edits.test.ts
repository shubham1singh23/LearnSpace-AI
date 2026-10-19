import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { captureSelection, defaultPreferences, selectionRequest, transformEdit } from '@learnspace/shared';
import { ModelError } from '@learnspace/ai';
import { ConfigurationService } from '../../apps/api/src/ai/configuration.js';
import { OperationService } from '../../apps/api/src/ai/operations.js';
import { EditService } from '../../apps/api/src/ai/edit-service.js';
import { createDatabase } from '../../apps/api/src/db.js';
import { parseEnvironment } from '../../apps/api/src/config.js';
import { LessonService } from '../../apps/api/src/workspace/lesson-service.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Separate TEST_DATABASE_URL required.');
const db = createDatabase(url); const courses: string[] = []; const configs: string[] = [];
const original = await db.workspaceSettings.findUnique({ where: { id: 1 } });
let output: unknown = { fragment: { kind: 'inline', text: 'Clearer words' } }; let calls = 0; let lastInput = ''; let barrier: Promise<void> | undefined;
const configuration = new ConfigurationService(db, parseEnvironment({ DATABASE_URL: url }), () => ({ async generate(_system, input, schema) { lastInput = input; calls++; await barrier; const result = schema.safeParse(output); if (!result.success) throw new ModelError('INVALID_OUTPUT'); return result.data; } }));
const operations = new OperationService(configuration); const edits = new EditService(operations); const lessons = new LessonService(db);
afterAll(async () => { operations.stop(); await db.lesson.deleteMany({ where: { topic: { courseId: { in: courses } } } }); await db.course.deleteMany({ where: { id: { in: courses } } }); if (original) await db.workspaceSettings.update({ where: { id: 1 }, data: { textConfigId: original.textConfigId } }); await db.aiProviderConfiguration.deleteMany({ where: { id: { in: configs } } }); await db.$disconnect(); });
async function fixture() {
  output = { fragment: { kind: 'inline', text: 'Clearer words' } };
  const config = await configuration.write({ purpose: 'text', provider: 'ollama', modelId: 'fake-only', options: {}, credential: { source: 'none' } }); configs.push(config.id); await configuration.patchSettings({ textConfigId: config.id });
  const course = await db.course.create({ data: { title: 'Selection fixture', goal: 'Teach safely', preferences: defaultPreferences } }); courses.push(course.id);
  const topic = await db.topic.create({ data: { courseId: course.id, title: 'Topic', kind: 'topic', position: 0, objectives: [] } });
  const document = { type: 'doc' as const, content: [{ type: 'paragraph' as const, attrs: { blockId: randomUUID() }, content: [{ type: 'text' as const, text: 'Original notes', marks: [{ type: 'bold' as const }] }] }] };
  const lesson = await lessons.create(topic.id, { mutationId: randomUUID(), documentSchemaVersion: 1, document });
  const target = await captureSelection(document, 1, 1, 9);
  return { course, topic, lesson, document, body: { baseRevision: 1, action: 'simplify' as const, mode: 'replace' as const, target: selectionRequest(target) } };
}
async function terminal(id: string) { for (let i = 0; i < 150; i++) { const op = await operations.get(id); if (!['pending', 'running'].includes(op.status)) return op; await new Promise(done => setTimeout(done, 10)); } throw new Error('Edit did not complete'); }
it('durably prepares without changing notes, discovers edits and replays generation exactly', async () => {
  const f = await fixture(); const key = randomUUID(); const before = calls;
  const start = await edits.start(f.lesson.id, key, f.body); const ready = await terminal(start.id);
  expect(ready.status).toBe('ready'); expect(ready.result?.type).toBe('edit'); expect(lastInput).toContain('Original notes');
  expect((await lessons.load(f.topic.id)).document).toEqual(f.document);
  expect(await db.documentVersion.count({ where: { lessonId: f.lesson.id } })).toBe(0);
  expect((await edits.start(f.lesson.id, key, f.body)).id).toBe(start.id); expect(calls - before).toBe(1);
  expect((await operations.list(f.course.id)).operations.some(op => op.id === start.id)).toBe(true);
  await expect(edits.start(f.lesson.id, key, { ...f.body, action: 'rewrite' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  await expect(edits.start(f.lesson.id, randomUUID(), { ...f.body, target: { ...f.body.target, sliceHash: 'a'.repeat(64) } })).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });
  expect(calls - before).toBe(1);
});
it('invalid output and expiry retain canonical notes', async () => {
  const f = await fixture(); output = { fragment: { kind: 'inline', text: 'Unsafe', assetId: randomUUID() } }; const before = calls;
  const start = await edits.start(f.lesson.id, randomUUID(), f.body); expect((await terminal(start.id)).status).toBe('failed'); expect(calls - before).toBe(2);
  output = { fragment: { kind: 'inline', text: 'Safe' } };
  const next = await edits.start(f.lesson.id, randomUUID(), f.body); await terminal(next.id);
  await db.aiOperation.update({ where: { id: next.id }, data: { updatedAt: new Date(Date.now() - 8 * 86400000) } });
  expect((await operations.get(next.id)).status).toBe('expired'); expect((await lessons.load(f.topic.id)).revision).toBe(1);
});
it('cancellation and newer saved revisions fence delayed model results', async () => {
  const f = await fixture(); let release!: () => void; barrier = new Promise<void>(done => { release = done; });
  const cancelled = await edits.start(f.lesson.id, randomUUID(), f.body); await operations.cancel(cancelled.id); release(); barrier = undefined;
  expect((await terminal(cancelled.id)).status).toBe('cancelled');
  barrier = new Promise<void>(done => { release = done; });
  const stale = await edits.start(f.lesson.id, randomUUID(), f.body);
  await lessons.save(f.lesson.id, { baseRevision: 1, mutationId: randomUUID(), documentSchemaVersion: 1, document: { ...f.document, content: [{ ...f.document.content[0]!, content: [{ type: 'text', text: 'Newer edit' }] }] } });
  release(); barrier = undefined;
  expect((await terminal(stale.id)).errorCode).toBe('STALE_CONTEXT'); expect((await lessons.load(f.topic.id)).revision).toBe(2);
});
async function proposal(f: Awaited<ReturnType<typeof fixture>>) {
  const started = await edits.start(f.lesson.id, randomUUID(), f.body); const ready = await terminal(started.id);
  if (ready.result?.type !== 'edit') throw new Error(`Expected edit: ${ready.errorCode}`);
  const document = (await transformEdit(f.document, ready.result.prepared)).document;
  return { started, document, body: { baseRevision: 1, mutationId: randomUUID(), documentSchemaVersion: 1 as const, document, aiOperationId: started.id } };
}
it('atomically applies one revision and snapshot, and replays identical receipts after later manual saves', async () => {
  const f = await fixture(); const p = await proposal(f);
  const [first, retry] = await Promise.all([lessons.save(f.lesson.id, p.body), lessons.save(f.lesson.id, p.body)]);
  expect(first).toEqual(retry); expect(first.revision).toBe(2);
  expect((await lessons.version(f.lesson.id, 1)).document).toEqual(f.document);
  expect(await db.documentVersion.count({ where: { lessonId: f.lesson.id } })).toBe(1);
  expect(await db.lesson.findUnique({ where: { id: f.lesson.id } })).toMatchObject({ source: 'ai_edit', operationId: p.started.id }); expect((await operations.get(p.started.id)).status).toBe('applied');
  await lessons.save(f.lesson.id, { baseRevision: 2, mutationId: randomUUID(), documentSchemaVersion: 1, document: f.document });
  expect(await lessons.save(f.lesson.id, p.body)).toEqual(first); expect((await lessons.load(f.topic.id)).revision).toBe(3);
  await expect(lessons.save(f.lesson.id, { ...p.body, document: f.document })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
});
it('rejects forged transformed content and foreign operations without snapshots or receipts', async () => {
  const f = await fixture(); const p = await proposal(f); const other = await fixture();
  await expect(lessons.save(other.lesson.id, p.body)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const forged = { ...p.document, content: [...p.document.content, { type: 'paragraph' as const, attrs: { blockId: randomUUID() }, content: [{ type: 'text' as const, text: 'Unrelated injected content' }] }] };
  await expect(lessons.save(f.lesson.id, { ...p.body, document: forged })).rejects.toMatchObject({ code: 'AI_TRANSFORM_MISMATCH' });
  expect((await lessons.load(f.topic.id)).revision).toBe(1); expect(await db.documentVersion.count({ where: { lessonId: f.lesson.id } })).toBe(0);
  expect(await db.lessonMutation.count({ where: { lessonId: f.lesson.id, mutationId: p.body.mutationId } })).toBe(0); expect((await operations.get(p.started.id)).status).toBe('ready');
});
it('rolls back document, snapshot, receipt and operation together when the final receipt write fails', async () => {
  const f = await fixture(); const p = await proposal(f);
  await db.$executeRawUnsafe(`ALTER TABLE lesson_mutations ADD CONSTRAINT m4_receipt_failure_fixture CHECK ("mutationId" <> '${p.body.mutationId}'::uuid)`);
  try {
    await expect(lessons.save(f.lesson.id, p.body)).rejects.toThrow(); expect((await lessons.load(f.topic.id)).document).toEqual(f.document);
    expect(await db.documentVersion.count({ where: { lessonId: f.lesson.id } })).toBe(0); expect((await operations.get(p.started.id)).status).toBe('ready');
  } finally { await db.$executeRaw`ALTER TABLE lesson_mutations DROP CONSTRAINT m4_receipt_failure_fixture`; }
  expect((await lessons.save(f.lesson.id, p.body)).revision).toBe(2);
});
it('rejects cancelled, expired, tree-stale and two-tab-stale acceptance', async () => {
  for (const reason of ['cancelled', 'expired', 'tree', 'revision'] as const) {
    const f = await fixture(); const p = await proposal(f);
    if (reason === 'cancelled') await operations.cancel(p.started.id);
    if (reason === 'expired') { await db.aiOperation.update({ where: { id: p.started.id }, data: { updatedAt: new Date(Date.now() - 8 * 86400000) } }); await operations.reconcile(); }
    if (reason === 'tree') await db.course.update({ where: { id: f.course.id }, data: { treeRevision: { increment: 1 } } });
    if (reason === 'revision') await lessons.save(f.lesson.id, { baseRevision: 1, mutationId: randomUUID(), documentSchemaVersion: 1, document: { ...f.document, content: [{ ...f.document.content[0]!, content: [{ type: 'text', text: 'Other tab wins' }] }] } });
    await expect(lessons.save(f.lesson.id, p.body)).rejects.toMatchObject({ code: reason === 'tree' ? 'STALE_CONTEXT' : reason === 'revision' ? 'REVISION_CONFLICT' : 'OPERATION_NOT_READY' });
    expect((await lessons.load(f.topic.id)).revision).toBe(reason === 'revision' ? 2 : 1);
  }
});
it('preserves current and historical assets through edit acceptance and restore', async () => {
  const f = await fixture(); const asset = await db.asset.create({ data: { courseId: f.course.id, storageKey: `${randomUUID()}.png`, originalName: 'history.png', mimeType: 'image/png', bytes: 8, width: 1, height: 1, sha256: 'a'.repeat(64), source: 'upload', state: 'ready' } });
  const illustrated = { ...f.document, content: [...f.document.content, { type: 'image' as const, attrs: { blockId: randomUUID(), assetId: asset.id, alt: 'Historical diagram', width: 1, height: 1 } }] };
  await lessons.save(f.lesson.id, { baseRevision: 1, mutationId: randomUUID(), documentSchemaVersion: 1, document: illustrated });
  const target = await captureSelection(illustrated, 2, 1, 9); const start = await edits.start(f.lesson.id, randomUUID(), { ...f.body, baseRevision: 2, target: selectionRequest(target) }); const ready = await terminal(start.id);
  if (ready.result?.type !== 'edit') throw new Error('Expected ready edit'); expect(ready.context.omitted).toBe(true);
  const document = (await transformEdit(illustrated, ready.result.prepared)).document;
  await lessons.save(f.lesson.id, { baseRevision: 2, mutationId: randomUUID(), documentSchemaVersion: 1, document, aiOperationId: start.id });
  expect(await db.lessonAsset.count({ where: { lessonId: f.lesson.id, assetId: asset.id } })).toBe(1); expect(await db.versionAsset.count({ where: { assetId: asset.id } })).toBe(1);
  await lessons.restore(f.lesson.id, { baseRevision: 3, sourceRevision: 2, mutationId: randomUUID(), confirm: true }); expect((await lessons.load(f.topic.id)).document).toEqual(illustrated);
  expect(await db.versionAsset.count({ where: { assetId: asset.id } })).toBe(2);
});
it('serializes cancellation against acceptance and fences an expired execution lease', async () => {
  const f = await fixture(); const p = await proposal(f);
  const [accepted] = await Promise.allSettled([lessons.save(f.lesson.id, p.body), operations.cancel(p.started.id)]);
  const current = await lessons.load(f.topic.id); const operation = await operations.get(p.started.id);
  expect(current.revision).toBe(accepted.status === 'fulfilled' ? 2 : 1); expect(operation.status).toBe(accepted.status === 'fulfilled' ? 'applied' : 'cancelled');
  const next = await fixture(); let release!: () => void; barrier = new Promise<void>(done => { release = done; });
  const expired = await edits.start(next.lesson.id, randomUUID(), next.body);
  await db.aiOperation.update({ where: { id: expired.id }, data: { leaseUntil: new Date(Date.now() - 1000) } }); await operations.reconcile(); release(); barrier = undefined;
  expect((await terminal(expired.id)).status).toBe('interrupted'); expect((await lessons.load(next.topic.id)).revision).toBe(1);
});
