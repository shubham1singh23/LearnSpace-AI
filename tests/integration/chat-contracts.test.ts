import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { defaultPreferences } from '@learnspace/shared';
import { createDatabase } from '../../apps/api/src/db.js';
import { LessonService } from '../../apps/api/src/workspace/lesson-service.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Separate TEST_DATABASE_URL required.');
const db = createDatabase(url); const courses: string[] = [];
afterAll(async () => { await db.course.deleteMany({ where: { id: { in: courses } } }); await db.$disconnect(); });
async function fixture() {
  const course = await db.course.create({ data: { title: 'M5 contract fixture', goal: 'Isolated constraints', preferences: defaultPreferences } }); courses.push(course.id);
  const topic = await db.topic.create({ data: { courseId: course.id, title: 'Leaf', kind: 'topic', position: 0, objectives: [] } });
  const lesson = await new LessonService(db).create(topic.id, { mutationId: randomUUID(), documentSchemaVersion: 1, document: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [] }] } });
  return { course, topic, lesson };
}
it('enforces global turn/role and lesson sequence uniqueness without altering notes', async () => {
  const a = await fixture(); const b = await fixture(); const turnId = randomUUID();
  const data = { lessonId: a.lesson.id, turnId, role: 'user', sequence: 0, content: 'Question', status: 'pending', contextRevision: 1 };
  await db.chatMessage.create({ data });
  await expect(db.chatMessage.create({ data: { ...data, lessonId: b.lesson.id } })).rejects.toMatchObject({ code: 'P2002' });
  await expect(db.chatMessage.create({ data: { ...data, turnId: randomUUID() } })).rejects.toMatchObject({ code: 'P2002' });
  await db.chatMessage.create({ data: { ...data, role: 'assistant', sequence: 1, status: 'completed', content: 'Answer' } });
  expect(await db.chatMessage.count({ where: { lessonId: a.lesson.id } })).toBe(2);
  expect((await db.lesson.findUniqueOrThrow({ where: { id: a.lesson.id } })).revision).toBe(1);
  expect(await db.documentVersion.count({ where: { lessonId: a.lesson.id } })).toBe(0);
});
it('allows one active chat per stable lesson scope and retains terminal attempts', async () => {
  const f = await fixture(); const scopeKey = `chat:${f.lesson.id}`;
  const data = { courseId: f.course.id, topicId: f.topic.id, lessonId: f.lesson.id, kind: 'chat', status: 'running', scopeKey, idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64), modelSnapshot: {}, promptVersion: 'chat-v1', ownerToken: randomUUID(), leaseUntil: new Date(Date.now() + 30000) };
  const first = await db.aiOperation.create({ data });
  await expect(db.aiOperation.create({ data: { ...data, idempotencyKey: randomUUID() } })).rejects.toMatchObject({ code: 'P2002' });
  await db.aiOperation.update({ where: { id: first.id }, data: { status: 'interrupted', ownerToken: null, leaseUntil: null } });
  await db.aiOperation.create({ data: { ...data, idempotencyKey: randomUUID() } });
  expect(await db.aiOperation.count({ where: { scopeKey } })).toBe(2);
});
