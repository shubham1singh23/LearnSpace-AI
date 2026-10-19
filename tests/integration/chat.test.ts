import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { defaultPreferences } from '@learnspace/shared';
import { captureInsertion, fingerprint, transformInsertion } from '@learnspace/shared';
import { ModelError } from '@learnspace/ai';
import { ConfigurationService } from '../../apps/api/src/ai/configuration.js';
import { OperationService } from '../../apps/api/src/ai/operations.js';
import { ChatService } from '../../apps/api/src/ai/chat-service.js';
import { createDatabase } from '../../apps/api/src/db.js';
import { parseEnvironment } from '../../apps/api/src/config.js';
import { LessonService } from '../../apps/api/src/workspace/lesson-service.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Separate TEST_DATABASE_URL required.');
const db = createDatabase(url); const courses: string[] = []; const configs: string[] = [];
const original = await db.workspaceSettings.findUnique({ where: { id: 1 } });
let output: unknown = { text: 'A complete answer' }; let calls = 0; let lastInput = ''; let barrier: Promise<void> | undefined;
const configuration = new ConfigurationService(db, parseEnvironment({ DATABASE_URL: url }), () => ({ async generate(_system, _input, schema) { calls++; lastInput = _input; await barrier; const result = schema.safeParse(output); if (!result.success) throw new ModelError('INVALID_OUTPUT'); return result.data; } }));
const operations = new OperationService(configuration); const chat = new ChatService(operations); const lessons = new LessonService(db);
afterAll(async () => { operations.stop(); await db.lesson.deleteMany({ where: { topic: { courseId: { in: courses } } } }); await db.course.deleteMany({ where: { id: { in: courses } } }); if (original) await db.workspaceSettings.update({ where: { id: 1 }, data: { textConfigId: original.textConfigId } }); await db.aiProviderConfiguration.deleteMany({ where: { id: { in: configs } } }); await db.$disconnect(); });
async function fixture() {
  output = { text: 'A complete answer' };
  const config = await configuration.write({ purpose: 'text', provider: 'ollama', modelId: 'fake-only', options: {}, credential: { source: 'none' } }); configs.push(config.id); await configuration.patchSettings({ textConfigId: config.id });
  const course = await db.course.create({ data: { title: 'Chat fixture', goal: 'Teach safely', preferences: defaultPreferences } }); courses.push(course.id);
  const topic = await db.topic.create({ data: { courseId: course.id, title: 'Topic', kind: 'topic', position: 0, objectives: [] } });
  const document = { type: 'doc' as const, content: [{ type: 'paragraph' as const, attrs: { blockId: randomUUID() }, content: [{ type: 'text' as const, text: 'Custom saved notes' }] }] };
  const lesson = await lessons.create(topic.id, { mutationId: randomUUID(), documentSchemaVersion: 1, document });
  return { course, topic, lesson, document, body: { baseRevision: 1, message: 'Explain my notes', clientTurnId: randomUUID() } };
}
async function terminal(id: string) { for (let i = 0; i < 200; i++) { const op = await operations.get(id); if (!['pending', 'running'].includes(op.status)) return op; await new Promise(done => setTimeout(done, 10)); } throw new Error('Chat did not complete'); }
it('reserves the user before invocation and atomically completes answer, usage and operation without note writes', async () => {
  const f = await fixture(); const key = randomUUID(); const before = calls; let release!: () => void; barrier = new Promise<void>(done => { release = done; });
  const started = await chat.start(f.lesson.id, key, f.body);
  expect(await db.chatMessage.findMany({ where: { lessonId: f.lesson.id } })).toMatchObject([{ role: 'user', status: 'pending', sequence: 0 }]);
  await expect(chat.start(f.lesson.id, randomUUID(), { ...f.body, clientTurnId: randomUUID() })).rejects.toMatchObject({ code: 'CHAT_TURN_ACTIVE' });
  expect((await chat.start(f.lesson.id, key, f.body)).id).toBe(started.id);
  release(); barrier = undefined;
  expect((await terminal(started.id)).result?.type).toBe('applied_chat'); expect(calls - before).toBe(1);
  const page = await chat.messages(f.lesson.id, {}); expect(page.messages.map(m => [m.role, m.status, m.sequence])).toEqual([['user', 'completed', 0], ['assistant', 'completed', 1]]);
  expect(await db.modelUsage.count({ where: { operationId: started.id } })).toBe(1);
  expect(lastInput).toContain('Custom saved notes'); expect((await terminal(started.id)).context.chat?.historyMessageIds).toEqual([]);
  expect((await lessons.load(f.topic.id)).document).toEqual(f.document); expect(await db.documentVersion.count({ where: { lessonId: f.lesson.id } })).toBe(0);
  await configuration.patchSettings({ textConfigId: null }); expect((await chat.start(f.lesson.id, key, f.body)).id).toBe(started.id);
  await expect(chat.start(f.lesson.id, key, { ...f.body, message: 'Changed' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
});
it('fails bounded invalid output, retries the same user once, and rejects completed or foreign turn reuse', async () => {
  const f = await fixture(); output = { text: 'Bad', assets: ['forged'] };
  const failed = await chat.start(f.lesson.id, randomUUID(), f.body); expect((await terminal(failed.id)).status).toBe('failed');
  expect((await chat.messages(f.lesson.id, {})).messages).toMatchObject([{ role: 'user', status: 'failed', sequence: 0 }]);
  output = { text: 'Retry answer' }; const retry = await chat.start(f.lesson.id, randomUUID(), { ...f.body, retryOfOperationId: failed.id }); expect((await terminal(retry.id)).status).toBe('applied');
  expect(await db.chatMessage.count({ where: { turnId: f.body.clientTurnId, role: 'user' } })).toBe(1);
  await expect(chat.start(f.lesson.id, randomUUID(), f.body)).rejects.toMatchObject({ code: 'TURN_ALREADY_COMPLETED' });
  const other = await fixture(); await expect(chat.start(other.lesson.id, randomUUID(), { ...other.body, clientTurnId: f.body.clientTurnId })).rejects.toMatchObject({ code: 'INVALID_RETRY' });
});
it('cancellation and lease recovery fence late answers and synchronize the pending user', async () => {
  for (const reason of ['cancel', 'lease'] as const) {
    const f = await fixture(); let release!: () => void; barrier = new Promise<void>(done => { release = done; });
    const started = await chat.start(f.lesson.id, randomUUID(), f.body);
    if (reason === 'cancel') await operations.cancel(started.id);
    else { await db.aiOperation.update({ where: { id: started.id }, data: { leaseUntil: new Date(0) } }); await new OperationService(configuration).reconcile(); }
    release(); barrier = undefined; await new Promise(done => setTimeout(done, 40));
    const status = reason === 'cancel' ? 'cancelled' : 'interrupted'; expect((await terminal(started.id)).status).toBe(status);
    expect((await chat.messages(f.lesson.id, {})).messages).toMatchObject([{ role: 'user', status }]);
    expect(await db.chatMessage.count({ where: { lessonId: f.lesson.id, role: 'assistant' } })).toBe(0);
  }
});
it('rolls back assistant and usage on a finalization failure and preserves old-revision chat after newer note saves', async () => {
  const f = await fixture();
  await db.$executeRawUnsafe(`ALTER TABLE chat_messages ADD CONSTRAINT m5_chat_failure_fixture CHECK ("lessonId" <> '${f.lesson.id}'::uuid OR role <> 'assistant')`);
  try {
    const start = await chat.start(f.lesson.id, randomUUID(), f.body); expect((await terminal(start.id)).status).toBe('failed');
    expect(await db.chatMessage.count({ where: { lessonId: f.lesson.id, role: 'assistant' } })).toBe(0);
    expect((await chat.messages(f.lesson.id, {})).messages[0]?.status).toBe('failed');
  } finally { await db.$executeRaw`ALTER TABLE chat_messages DROP CONSTRAINT m5_chat_failure_fixture`; }
  let release!: () => void; barrier = new Promise<void>(done => { release = done; });
  const next = await chat.start(f.lesson.id, randomUUID(), { ...f.body, clientTurnId: randomUUID() });
  await lessons.save(f.lesson.id, { baseRevision: 1, mutationId: randomUUID(), documentSchemaVersion: 1, document: { ...f.document, content: [{ ...f.document.content[0]!, content: [{ type: 'text', text: 'New notes' }] }] } });
  release(); barrier = undefined; expect((await terminal(next.id)).status).toBe('applied');
  expect((await chat.messages(f.lesson.id, {})).messages.at(-1)?.contextRevision).toBe(1); expect((await lessons.load(f.topic.id)).revision).toBe(2);
  const newer = await chat.start(f.lesson.id, randomUUID(), { ...f.body, baseRevision: 2, clientTurnId: randomUUID() }); await terminal(newer.id);
  expect(lastInput).toContain('New notes'); expect(lastInput).not.toContain('Custom saved notes'); expect((await terminal(newer.id)).context.chat?.historyMessageIds).toHaveLength(2);
});
it('paginates by owned exclusive cursors and rejects changed-context retries', async () => {
  const f = await fixture(); const other = await fixture(); output = { extra: true };
  const failed = await chat.start(f.lesson.id, randomUUID(), f.body); await terminal(failed.id);
  await db.course.update({ where: { id: f.course.id }, data: { goal: 'Changed context', treeRevision: { increment: 1 } } });
  await expect(chat.start(f.lesson.id, randomUUID(), { ...f.body, retryOfOperationId: failed.id })).rejects.toMatchObject({ code: 'TURN_CONTEXT_CHANGED' });
  output = { text: 'New answer' }; const next = await chat.start(f.lesson.id, randomUUID(), { ...f.body, clientTurnId: randomUUID() }); await terminal(next.id);
  const last = await chat.messages(f.lesson.id, { limit: 1 }); expect(last.messages[0]?.role).toBe('assistant');
  const older = await chat.messages(f.lesson.id, { before: last.messages[0]!.id }); expect(older.messages.map(m => m.sequence)).toEqual([0, 2]);
  expect((await chat.messages(f.lesson.id, { after: older.messages.at(-1)!.id })).messages[0]?.id).toBe(last.messages[0]!.id);
  await expect(chat.messages(other.lesson.id, { before: last.messages[0]!.id })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
});
it('rolls back reservation without configuration, deduplicates concurrent starts and does not resurrect deleted owners', async () => {
  const f = await fixture(); await configuration.patchSettings({ textConfigId: null });
  await expect(chat.start(f.lesson.id, randomUUID(), f.body)).rejects.toMatchObject({ code: 'MODEL_NOT_CONFIGURED' });
  expect(await db.chatMessage.count({ where: { lessonId: f.lesson.id } })).toBe(0);
  expect(await db.aiOperation.count({ where: { lessonId: f.lesson.id } })).toBe(0);
  await configuration.patchSettings({ textConfigId: configs.at(-1)! });
  let release!: () => void; barrier = new Promise<void>(done => { release = done; }); const key = randomUUID(); const before = calls;
  const [a, b] = await Promise.all([chat.start(f.lesson.id, key, f.body), chat.start(f.lesson.id, key, f.body)]); expect(a.id).toBe(b.id);
  await db.lesson.delete({ where: { id: f.lesson.id } }); release(); barrier = undefined; await new Promise(done => setTimeout(done, 80));
  expect(calls - before).toBe(1); expect(await db.chatMessage.count({ where: { lessonId: f.lesson.id } })).toBe(0); expect(await db.aiOperation.count({ where: { id: a.id } })).toBe(0);
});
it('saves explicit chat insertion as manual provenance with receipts and snapshots, leaving conversation unchanged', async () => {
  const f = await fixture(); const started = await chat.start(f.lesson.id, randomUUID(), f.body); await terminal(started.id);
  const messages = await chat.messages(f.lesson.id, {}); const message = messages.messages.at(-1)!;
  const anchor = await captureInsertion(f.document, 2, { lessonId: f.lesson.id, baseRevision: 1, editorInstanceId: randomUUID(), documentSequence: 0, localSequence: 0, source: { kind: 'chat_insert', sourceId: message.id, sourceHash: await fingerprint(message.content) } });
  const transformed = await transformInsertion(f.document, anchor, message.content);
  const body = { baseRevision: 1, mutationId: randomUUID(), documentSchemaVersion: 1 as const, document: transformed.document };
  const receipt = await lessons.save(f.lesson.id, body); expect(receipt.revision).toBe(2);
  expect((await db.lesson.findUniqueOrThrow({ where: { id: f.lesson.id } })).source).toBe('manual');
  expect((await lessons.version(f.lesson.id, 1)).document).toEqual(f.document);
  await lessons.save(f.lesson.id, { ...body, baseRevision: 2, mutationId: randomUUID(), document: f.document });
  expect(await lessons.save(f.lesson.id, body)).toEqual(receipt); expect(await chat.messages(f.lesson.id, {})).toEqual(messages); expect((await operations.get(started.id)).status).toBe('applied');
  await expect(lessons.save(f.lesson.id, { ...body, mutationId: randomUUID() })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
});
