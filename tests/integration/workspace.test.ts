import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultPreferences, treeSchema, topicMutationSchema } from '@learnspace/shared';
import { createDatabase } from '../../apps/api/src/db.js';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnvironment } from '../../apps/api/src/config.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Separate TEST_DATABASE_URL required.');
const db = createDatabase(url);
const assetRoot = mkdtempSync(join(tmpdir(), 'learnspace-m2-assets-'));
const app = createApp(parseEnvironment({ DATABASE_URL: url }), async () => ({ status: 'ok', service: 'learnspace-api', database: 'ready', storage: 'ready' }), undefined, db, assetRoot);
const courses: string[] = [];
const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) => request(app)[method](`/api/v1${path}`).set('Host', '127.0.0.1:3001').set('Origin', 'http://127.0.0.1:3001');
async function course() {
  const response = await api('post', '/courses').send({ title: 'Manual course', goal: 'Persistence fixtures', preferences: defaultPreferences }).expect(201);
  const id = String(response.body.data.id); courses.push(id); return id;
}
async function add(courseId: string, revision: number, title: string, position: number, parentId: string | null = null) {
  const response = await api('post', `/courses/${courseId}/topics`).send({ baseTreeRevision: revision, title, position, parentId, kind: 'topic', objectives: [] }).expect(201);
  topicMutationSchema.parse(response.body.data);
  return treeSchema.parse((await api('get', `/courses/${courseId}/tree`).expect(200)).body.data);
}
afterAll(async () => {
  await db.$transaction(async tx => {
    await tx.lesson.deleteMany({ where: { topic: { courseId: { in: courses } } } });
    await tx.course.deleteMany({ where: { id: { in: courses } } });
  });
  await db.$disconnect();
  await rm(assetRoot, { recursive: true, force: true });
});

describe('Phase 4 asset history gate', () => {
  it('decodes uploads and keeps image bytes accessible after removal from current notes and restoration', async () => {
    const id = await course(); const topic = (await add(id, 0, 'Image notes', 0)).topics[0]!;
    const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#ff0000' } }).png().toBuffer();
    await api('post', `/courses/${id}/assets`).attach('file', bytes, 'image.png').expect(403);
    const uploaded = await api('post', `/courses/${id}/assets`).set('X-LearnSpace-Request', '1').field('alt', 'A red square').attach('file', bytes, { filename: '../../square.png', contentType: 'image/png' }).expect(201);
    const asset = uploaded.body.data as { id: string; url: string; width: number; height: number };
    expect(asset).toMatchObject({ width: 8, height: 6 });
    const document = { type: 'doc', content: [{ type: 'image', attrs: { blockId: randomUUID(), assetId: asset.id, alt: 'A red square', caption: 'Original', width: 8, height: 6 } }] };
    const created = await api('post', `/topics/${topic.id}/lessons`).send({ mutationId: randomUUID(), documentSchemaVersion: 1, document }).expect(201);
    const lessonId = String(created.body.data.id);
    const empty = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [] }] };
    await api('put', `/lessons/${lessonId}`).send({ mutationId: randomUUID(), baseRevision: 1, documentSchemaVersion: 1, document: empty }).expect(200);
    expect(await db.versionAsset.count({ where: { assetId: asset.id } })).toBe(1);
    await api('delete', `/assets/${asset.id}`).send({}).expect(409);
    const content = await api('get', `/assets/${asset.id}/content`).expect(200);
    expect(content.headers['content-type']).toContain('image/png');
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    await api('post', `/lessons/${lessonId}/restores`).send({ mutationId: randomUUID(), sourceRevision: 1, baseRevision: 2, confirm: true }).expect(200);
    expect((await api('get', `/topics/${topic.id}/lesson`).expect(200)).body.data.document).toEqual(document);
    await api('get', `/assets/${asset.id}/content`).expect(200);
    const foreignId = await course(); const foreignTopic = (await add(foreignId, 0, 'Foreign', 0)).topics[0]!;
    await api('post', `/topics/${foreignTopic.id}/lessons`).send({ mutationId: randomUUID(), documentSchemaVersion: 1, document }).expect(409);
    await api('delete', `/courses/${id}`).send({ baseTreeRevision: 1, confirm: true }).expect(204);
  });
  it('rejects active formats, MIME spoofing, corrupt and oversized uploads without ready records', async () => {
    const id = await course();
    const upload = () => api('post', `/courses/${id}/assets`).set('X-LearnSpace-Request', '1');
    await upload().attach('file', Buffer.from('<svg/>'), { filename: 'x.svg', contentType: 'image/svg+xml' }).expect(415);
    await upload().attach('file', Buffer.from('<script/>'), { filename: 'x.png', contentType: 'image/png' }).expect(422);
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
    await upload().attach('file', png, { filename: 'x.jpeg', contentType: 'image/jpeg' }).expect(422);
    await upload().attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'x.png', contentType: 'image/png' }).expect(413);
    expect(await db.asset.count({ where: { courseId: id } })).toBe(0);
  });
});
describe('Phase 2 real PostgreSQL gate', () => {
  it('creates nested topics, renames, reorders and moves while preserving dense positions', async () => {
    const id = await course();
    const a = (await add(id, 0, 'A', 0)).topics[0]!;
    let tree = await add(id, 1, 'B', 1);
    const b = tree.topics.find(topic => topic.title === 'B')!;
    tree = await add(id, 2, 'Nested', 0, a.id);
    const nested = tree.topics.find(topic => topic.title === 'Nested')!;
    await api('patch', `/topics/${nested.id}`).send({ baseTreeRevision: 3, title: 'Renamed' }).expect(200);
    await api('put', `/courses/${id}/topic-order`).send({ baseTreeRevision: 4, parentId: null, orderedSiblingIds: [b.id, a.id] }).expect(200);
    await api('post', `/courses/${id}/topic-moves`).send({ baseTreeRevision: 5, topicId: nested.id, newParentId: b.id, orderedSiblingIds: [nested.id] }).expect(200);
    tree = treeSchema.parse((await api('get', `/courses/${id}/tree`).expect(200)).body.data);
    expect(tree.treeRevision).toBe(6);
    expect(tree.topics.find(topic => topic.id === nested.id)).toMatchObject({ parentId: b.id, title: 'Renamed', position: 0 });
    expect(tree.topics.filter(topic => topic.parentId === null).map(topic => topic.id)).toEqual([b.id, a.id]);
  });
  it('rejects cycles, foreign parents, incomplete orders, and simultaneous stale writes atomically', async () => {
    const id = await course(); const foreign = await course();
    const root = (await add(id, 0, 'Root', 0)).topics[0]!;
    const child = (await add(id, 1, 'Child', 0, root.id)).topics.find(topic => topic.title === 'Child')!;
    await api('post', `/courses/${id}/topic-moves`).send({ baseTreeRevision: 2, topicId: root.id, newParentId: child.id, orderedSiblingIds: [root.id] }).expect(422);
    await api('post', `/courses/${foreign}/topics`).send({ baseTreeRevision: 0, parentId: root.id, title: 'Foreign', kind: 'topic', position: 0, objectives: [] }).expect(422);
    await api('put', `/courses/${id}/topic-order`).send({ baseTreeRevision: 2, parentId: null, orderedSiblingIds: [] }).expect(422);
    const results = await Promise.all(['One', 'Two'].map(title => api('patch', `/topics/${child.id}`).send({ baseTreeRevision: 2, title })));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await db.course.findUniqueOrThrow({ where: { id } })).treeRevision).toBe(3);
  });
  it('wraps a populated leaf without changing lesson identity and deletes only confirmed subtrees', async () => {
    const id = await course(); const leaf = (await add(id, 0, 'Leaf', 0)).topics[0]!;
    const lesson = await db.lesson.create({ data: { topicId: leaf.id, document: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [] }] }, contentHash: 'a'.repeat(64) } });
    const response = await api('post', `/topics/${leaf.id}/wrap`).send({ baseTreeRevision: 1, containerTitle: 'Container' }).expect(201);
    topicMutationSchema.parse(response.body.data);
    const tree = treeSchema.parse((await api('get', `/courses/${id}/tree`).expect(200)).body.data);
    const container = tree.topics.find(topic => topic.title === 'Container')!;
    expect(tree.topics.find(topic => topic.id === leaf.id)).toMatchObject({ parentId: container.id, lessonId: lesson.id });
    await api('delete', `/topics/${container.id}`).send({ baseTreeRevision: 2, confirmSubtree: false }).expect(422);
    await api('delete', `/topics/${container.id}`).send({ baseTreeRevision: 1, confirmSubtree: true }).expect(409);
    await api('delete', `/topics/${container.id}`).send({ baseTreeRevision: 2, confirmSubtree: true }).expect(204);
    expect(await db.lesson.findUnique({ where: { id: lesson.id } })).toBeNull();
    expect(await db.topic.count({ where: { courseId: id } })).toBe(0);
  });
  it('preserves dependency choices, rejects prerequisite cycles and supports course CRUD', async () => {
    const id = await course(); const a = (await add(id, 0, 'A', 0)).topics[0]!;
    const b = (await add(id, 1, 'B', 1)).topics.find(topic => topic.title === 'B')!;
    await api('put', `/topics/${b.id}/prerequisites`).send({ baseTreeRevision: 2, prerequisiteIds: [a.id] }).expect(200);
    await api('patch', `/topics/${b.id}/prerequisites/${a.id}`).send({ choice: 'skip' }).expect(200);
    await api('put', `/topics/${b.id}/prerequisites`).send({ baseTreeRevision: 4, prerequisiteIds: [a.id] }).expect(200);
    expect((await db.topicPrerequisite.findUniqueOrThrow({ where: { topicId_prerequisiteId: { topicId: b.id, prerequisiteId: a.id } } })).choice).toBe('skip');
    await api('put', `/topics/${a.id}/prerequisites`).send({ baseTreeRevision: 5, prerequisiteIds: [b.id] }).expect(409);
    await api('patch', `/courses/${id}`).send({ baseTreeRevision: 5, title: 'Changed goal' }).expect(200);
    await api('get', `/courses/${id}`).expect(200);
    await api('get', '/courses?limit=1').expect(200);
    await api('delete', `/courses/${id}`).send({ baseTreeRevision: 6, confirm: true }).expect(204);
  });
});

describe('Phase 3 transaction gate', () => {
  const document = (text: string, blockId = randomUUID()) => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId }, content: text ? [{ type: 'text', text }] : [] }] });
  async function setup() {
    const id = await course(); const topic = (await add(id, 0, 'Notes', 0)).topics[0]!;
    const body = { mutationId: randomUUID(), documentSchemaVersion: 1, document: document('Original') };
    const response = await api('post', `/topics/${topic.id}/lessons`).send(body).expect(201);
    return { id, topic, body, lesson: response.body.data as { id: string; revision: number } };
  }
  it('replays creation and saves after lost responses, rejects mismatched IDs, and snapshots original provenance', async () => {
    const fixture = await setup(); const { lesson } = fixture;
    const replay = await api('post', `/topics/${fixture.topic.id}/lessons`).send(fixture.body).expect(201);
    expect(replay.body.data.id).toBe(lesson.id);
    await api('post', `/topics/${fixture.topic.id}/lessons`).send({ ...fixture.body, mutationId: randomUUID() }).expect(409);
    const body = { mutationId: randomUUID(), baseRevision: 1, documentSchemaVersion: 1, document: document('New edits') };
    const saved = await api('put', `/lessons/${lesson.id}`).send(body).expect(200);
    const later = await api('put', `/lessons/${lesson.id}`).send({ ...body, mutationId: randomUUID(), baseRevision: 2, document: document('Newest') }).expect(200);
    expect(later.body.data.revision).toBe(3);
    const lostAckReplay = await api('put', `/lessons/${lesson.id}`).send(body).expect(200);
    expect(lostAckReplay.body.data).toEqual(saved.body.data);
    await api('put', `/lessons/${lesson.id}`).send({ ...body, document: document('Different payload') }).expect(409);
    expect(await db.documentVersion.count({ where: { lessonId: lesson.id } })).toBe(2);
    const original = await api('get', `/lessons/${lesson.id}/versions/1`).expect(200);
    expect(original.body.data.document).toEqual(fixture.body.document);
    expect(original.body.data.source).toBe('manual');
    const createReplay = await api('post', `/topics/${fixture.topic.id}/lessons`).send(fixture.body).expect(201);
    expect(createReplay.body.data.revision).toBe(1);
    expect(createReplay.body.data.document).toEqual(fixture.body.document);
  });
  it('serializes competing revisions, keeps stale requests from writing, and records no-op receipts', async () => {
    const { lesson } = await setup();
    const body = { mutationId: randomUUID(), baseRevision: 1, documentSchemaVersion: 1, document: document('Competing') };
    const results = await Promise.all([api('put', `/lessons/${lesson.id}`).send(body), api('put', `/lessons/${lesson.id}`).send({ ...body, mutationId: randomUUID(), document: document('Other tab') })]);
    expect(results.map(value => value.status).sort()).toEqual([200, 409]);
    expect(results.find(value => value.status === 409)?.body.error.details.currentRevision).toBe(2);
    const saved = await db.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    await api('put', `/lessons/${lesson.id}`).send({ ...body, baseRevision: 2, mutationId: randomUUID(), document: saved.document }).expect(200);
    expect(await db.documentVersion.count({ where: { lessonId: lesson.id } })).toBe(1);
    expect((await db.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).revision).toBe(2);
  });
  it('serializes manual creation retries and the race between creating notes and adding a child', async () => {
    const id = await course(); const topic = (await add(id, 0, 'Creation race', 0)).topics[0]!;
    const body = { mutationId: randomUUID(), documentSchemaVersion: 1, document: document('Once only') };
    const repeated = await Promise.all([api('post', `/topics/${topic.id}/lessons`).send(body), api('post', `/topics/${topic.id}/lessons`).send(body)]);
    expect(repeated.map(value => value.status)).toEqual([201, 201]);
    expect(repeated[0]?.body.data.id).toBe(repeated[1]?.body.data.id);
    expect(await db.lesson.count({ where: { topicId: topic.id } })).toBe(1);
    const next = (await add(id, 1, 'Leaf race', 1)).topics.find(topic => topic.title === 'Leaf race')!;
    const results = await Promise.all([
      api('post', `/topics/${next.id}/lessons`).send({ ...body, mutationId: randomUUID() }),
      api('post', `/courses/${id}/topics`).send({ baseTreeRevision: 2, parentId: next.id, title: 'Child', kind: 'topic', position: 0, objectives: [] })
    ]);
    expect(results.map(value => value.status).sort()).toEqual([201, 409]);
    const ownsLesson = !!await db.lesson.findUnique({ where: { topicId: next.id } });
    expect(await db.topic.count({ where: { parentId: next.id } })).toBe(ownsLesson ? 0 : 1);
  });
  it('restores as N+1 with replay safety and validates assets before any transaction mutation', async () => {
    const fixture = await setup(); const { lesson } = fixture;
    const body = { mutationId: randomUUID(), baseRevision: 1, documentSchemaVersion: 1, document: document('Edited') };
    await api('put', `/lessons/${lesson.id}`).send(body).expect(200);
    const restore = { mutationId: randomUUID(), baseRevision: 2, sourceRevision: 1, confirm: true };
    const restored = await api('post', `/lessons/${lesson.id}/restores`).send(restore).expect(200);
    expect(restored.body.data.revision).toBe(3);
    expect((await api('post', `/lessons/${lesson.id}/restores`).send(restore).expect(200)).body.data).toEqual(restored.body.data);
    expect((await api('get', `/topics/${fixture.topic.id}/lesson`).expect(200)).body.data.document).toEqual(fixture.body.document);
    expect((await api('get', `/lessons/${lesson.id}/versions/3`).expect(200)).body.data).toMatchObject({ source: 'restore', restoredFromRevision: 1 });
    await api('post', `/lessons/${lesson.id}/restores`).send({ ...restore, mutationId: randomUUID() }).expect(409);
    const image = { type: 'image', attrs: { blockId: randomUUID(), assetId: randomUUID(), alt: '', width: 10, height: 10 } };
    await api('put', `/lessons/${lesson.id}`).send({ ...body, mutationId: randomUUID(), baseRevision: 3, document: { type: 'doc', content: [image] } }).expect(409);
    expect(await db.documentVersion.count({ where: { lessonId: lesson.id } })).toBe(2);
    const list = await api('get', `/lessons/${lesson.id}/versions?limit=1`).expect(200);
    expect(list.body.data).toMatchObject({ currentRevision: 3, page: { nextCursor: '2' } });
  });
  it('rolls back the document, snapshot and references if receipt insertion fails after the content update', async () => {
    const { lesson, body: created } = await setup(); const mutationId = randomUUID();
    // Test-database-only fault injection at the final transactional write.
    await db.$executeRawUnsafe(`ALTER TABLE lesson_mutations ADD CONSTRAINT m2_receipt_failure_fixture CHECK ("mutationId" <> '${mutationId}'::uuid)`);
    try {
      await api('put', `/lessons/${lesson.id}`).send({ mutationId, baseRevision: 1, documentSchemaVersion: 1, document: document('Must roll back') }).expect(500);
      const current = await db.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
      expect(current.revision).toBe(1); expect(current.document).toEqual(created.document);
      expect(await db.documentVersion.count({ where: { lessonId: lesson.id } })).toBe(0);
      expect(await db.lessonMutation.count({ where: { lessonId: lesson.id, mutationId } })).toBe(0);
    } finally { await db.$executeRaw`ALTER TABLE lesson_mutations DROP CONSTRAINT m2_receipt_failure_fixture`; }
  });
  it('returns a retryable unavailable response when PostgreSQL cannot accept a save transaction', async () => {
    const unavailable = createDatabase('postgresql://unused@127.0.0.1:1/learnspace_test_unavailable');
    try {
      const down = createApp(parseEnvironment({ DATABASE_URL: url }), async () => ({ status: 'unavailable', service: 'learnspace-api', database: 'unavailable', storage: 'ready' }), undefined, unavailable, assetRoot);
      const response = await request(down).put(`/api/v1/lessons/${randomUUID()}`).set('Host', '127.0.0.1:3001').set('Origin', 'http://127.0.0.1:3001').send({ baseRevision: 1, mutationId: randomUUID(), documentSchemaVersion: 1, document: document('Retain locally') }).expect(503);
      expect(response.body.error.retryable).toBe(true);
    } finally { await unavailable.$disconnect(); }
  });
});
