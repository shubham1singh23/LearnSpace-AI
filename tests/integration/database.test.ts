import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultPreferences, healthResponseSchema } from '@learnspace/shared';
import { createDatabase } from '../../apps/api/src/db.js';
import { createReadiness } from '../../apps/api/src/readiness.js';
import { parseEnvironment } from '../../apps/api/src/config.js';
import { createApp } from '../../apps/api/src/app.js';
import { seedSample, sampleCourseId } from '../../prisma/seed.js';

const url = process.env.TEST_DATABASE_URL;
// Fail rather than accidentally testing/cleaning the learner's development database.
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Set TEST_DATABASE_URL to a separate migrated learnspace_test database.');
const db = createDatabase(url);
const courses: string[] = [];
const hash = 'a'.repeat(64);
async function course() {
  const value = await db.course.create({ data: { title: 'Integration fixture', goal: 'Verify database constraints', preferences: defaultPreferences } });
  courses.push(value.id); return value;
}
async function topic(courseId: string, position = 0, parentId: string | null = null) {
  return db.topic.create({ data: { courseId, title: 'Fixture topic', position, parentId, kind: 'topic', objectives: [] } });
}
const notes = () => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [{ type: 'text', text: 'Manually edited fixture' }] }] });
async function lesson(topicId: string) { return db.lesson.create({ data: { topicId, document: notes(), contentHash: hash } }); }
beforeAll(async () => { await db.$connect(); });
afterAll(async () => {
  // Clean only IDs created by this suite. Never truncate/reset a database.
  try {
    await db.$transaction(async tx => {
      // RESTRICT protects historical assets: remove owning content before assets/course.
      await tx.lesson.deleteMany({ where: { topic: { courseId: { in: courses } } } });
      await tx.course.deleteMany({ where: { id: { in: courses } } });
    });
  } finally { await db.$disconnect(); }
});

describe('real PostgreSQL persistence foundation', () => {
  it('stores canonical documents in JSONB and rejects non-doc roots', async () => {
    const c = await course(); const t = await topic(c.id); const l = await lesson(t.id);
    const rows = await db.$queryRaw<{ type: string }[]>`SELECT pg_typeof(document)::text AS type FROM lessons WHERE id = ${l.id}::uuid`;
    expect(rows[0]?.type).toBe('jsonb');
    expect((await db.lesson.findUniqueOrThrow({ where: { id: l.id } })).document).toEqual(l.document);
    await expect(db.lesson.update({ where: { id: l.id }, data: { document: { text: 'not a document' } } })).rejects.toThrow();
  });
  it('enforces ordering for both nullable roots and children, plus same-course parents', async () => {
    const c = await course(); const root = await topic(c.id);
    await expect(topic(c.id)).rejects.toThrow();
    await topic(c.id, 0, root.id);
    await expect(topic(c.id, 0, root.id)).rejects.toThrow();
    const other = await course();
    await expect(topic(other.id, 0, root.id)).rejects.toThrow();
  });
  it('rejects hierarchy cycles, invalid positions and container lessons', async () => {
    const c = await course(); const root = await topic(c.id); const child = await topic(c.id, 0, root.id);
    await expect(db.topic.update({ where: { id: root.id }, data: { parentId: child.id, position: 1 } })).rejects.toThrow();
    await expect(topic(c.id, -1)).rejects.toThrow();
    await expect(lesson(root.id)).rejects.toThrow();
    await lesson(child.id);
    await expect(topic(c.id, 0, child.id)).rejects.toThrow();
  });
  it('enforces prerequisite graph and course references', async () => {
    const c = await course(); const a = await topic(c.id); const b = await topic(c.id, 1);
    await db.topicPrerequisite.create({ data: { topicId: b.id, prerequisiteId: a.id, courseId: c.id } });
    await expect(db.topicPrerequisite.create({ data: { topicId: a.id, prerequisiteId: b.id, courseId: c.id } })).rejects.toThrow();
    const other = await course(); const foreign = await topic(other.id);
    await expect(db.topicPrerequisite.create({ data: { topicId: a.id, prerequisiteId: foreign.id, courseId: c.id } })).rejects.toThrow();
  });
  it('provides atomic revision CAS and unique snapshots', async () => {
    const c = await course(); const t = await topic(c.id); const l = await lesson(t.id);
    const attempts = await Promise.all([1, 2].map(() => db.lesson.updateMany({ where: { id: l.id, revision: 1 }, data: { revision: { increment: 1 } } })));
    expect(attempts.map(value => value.count).sort()).toEqual([0, 1]);
    const snapshot = { lessonId: l.id, revision: 1, document: l.document ?? notes(), documentSchemaVersion: 1, contentHash: hash, source: 'manual' };
    await db.documentVersion.create({ data: snapshot });
    await expect(db.documentVersion.create({ data: snapshot })).rejects.toThrow();
    await expect(db.lesson.update({ where: { id: l.id }, data: { revision: 0 } })).rejects.toThrow();
  });
  it('prevents duplicate active generation but allows independent edit proposals', async () => {
    const c = await course(); const t = await topic(c.id);
    const data = { courseId: c.id, topicId: t.id, kind: 'initial_lesson', status: 'running', scopeKey: `initial_lesson:${t.id}`, requestHash: hash, modelSnapshot: {}, promptVersion: 'fixture' };
    await db.aiOperation.create({ data: { ...data, idempotencyKey: randomUUID() } });
    await expect(db.aiOperation.create({ data: { ...data, idempotencyKey: randomUUID() } })).rejects.toThrow();
    for (let i = 0; i < 2; i++) await db.aiOperation.create({ data: { ...data, kind: 'edit', scopeKey: `edit:${t.id}`, idempotencyKey: randomUUID() } });
    const other = await course();
    await expect(db.aiOperation.create({ data: { ...data, courseId: other.id, idempotencyKey: randomUUID() } })).rejects.toThrow();
  });
  it('preserves history asset references and prevents cross-course attachment', async () => {
    const c = await course(); const t = await topic(c.id); const l = await lesson(t.id);
    const asset = await db.asset.create({ data: { courseId: c.id, storageKey: `${randomUUID()}.png`, originalName: 'fixture.png', mimeType: 'image/png', bytes: 1, width: 1, height: 1, sha256: hash, source: 'upload', state: 'ready' } });
    const version = await db.documentVersion.create({ data: { lessonId: l.id, revision: 1, document: notes(), documentSchemaVersion: 1, contentHash: hash, source: 'manual' } });
    await db.versionAsset.create({ data: { versionId: version.id, assetId: asset.id } });
    await expect(db.asset.delete({ where: { id: asset.id } })).rejects.toThrow();
    const other = await course(); const foreignLesson = await lesson((await topic(other.id)).id);
    await expect(db.lessonAsset.create({ data: { lessonId: foreignLesson.id, assetId: asset.id } })).rejects.toThrow();
  });
  it('blocks course deletion while export lease exists and cascades after release', async () => {
    const c = await course(); const t = await topic(c.id); await lesson(t.id);
    const lease = await db.exportLease.create({ data: { courseId: c.id, ownerToken: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
    await expect(db.course.delete({ where: { id: c.id } })).rejects.toThrow();
    await db.exportLease.delete({ where: { id: lease.id } });
    await db.course.delete({ where: { id: c.id } });
    expect(await db.lesson.count({ where: { topicId: t.id } })).toBe(0);
  });
  it('enforces credential metadata and default purpose without storing keys', async () => {
    const config = await db.aiProviderConfiguration.create({ data: { purpose: 'image', provider: 'openai', modelId: 'fixture', options: {}, credentialSource: 'environment', credentialEnvName: 'OPENAI_API_KEY', capabilities: {}, registryVersion: 'fixture' } });
    try {
      await expect(db.aiProviderConfiguration.create({ data: { purpose: 'text', provider: 'openai', modelId: 'fixture', options: {}, credentialSource: 'environment', credentialEnvName: null, capabilities: {}, registryVersion: 'fixture' } })).rejects.toThrow();
      await expect(db.aiProviderConfiguration.update({ where: { id: config.id }, data: { options: { apiKey: 'not-allowed' } } })).rejects.toThrow();
      await expect(db.workspaceSettings.upsert({ where: { id: 1 }, create: { id: 1, preferences: defaultPreferences, textConfigId: config.id }, update: { textConfigId: config.id } })).rejects.toThrow();
    } finally { await db.aiProviderConfiguration.delete({ where: { id: config.id } }); }
  });
  it('seeds idempotently without any lesson generation or overwriting edits', async () => {
    await seedSample(db);
    const before = await db.lesson.count();
    const original = await db.course.findUniqueOrThrow({ where: { id: sampleCourseId } });
    await db.course.update({ where: { id: sampleCourseId }, data: { title: 'Learner customization' } });
    try {
      await seedSample(db);
      expect((await db.course.findUniqueOrThrow({ where: { id: sampleCourseId } })).title).toBe('Learner customization');
      expect(await db.topic.count({ where: { courseId: sampleCourseId } })).toBe(4);
      expect(await db.lesson.count()).toBe(before);
    } finally { await db.course.update({ where: { id: sampleCourseId }, data: { title: original.title } }); }
  });
  it('serves health using actual migration readiness and handles database outage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'learnspace-health-'));
    const env = parseEnvironment({ DATABASE_URL: url });
    const unreachable = createDatabase('postgresql://unused@127.0.0.1:1/unused');
    try {
      const live = await request(createApp(env, createReadiness(db, dir))).get('/api/health').set('Host', '127.0.0.1:3001').expect(200);
      expect(healthResponseSchema.parse(live.body).data.database).toBe('ready');
      const down = await request(createApp(env, createReadiness(unreachable, dir))).get('/api/health').set('Host', '127.0.0.1:3001').expect(503);
      expect(healthResponseSchema.parse(down.body).data.database).toBe('unavailable');
    } finally { await unreachable.$disconnect(); await rm(dir, { recursive: true, force: true }); }
  });
});
