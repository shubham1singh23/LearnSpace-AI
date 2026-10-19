import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, expect, it } from 'vitest';
import { defaultPreferences } from '@learnspace/shared';
import { createDatabase } from '../../apps/api/src/db.js';
import { ProgressService } from '../../apps/api/src/workspace/progress-service.js';
import { TreeService } from '../../apps/api/src/workspace/tree-service.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Separate TEST_DATABASE_URL required.');
const db = createDatabase(url); const courses: string[] = [];
const progress = new ProgressService(db); const tree = new TreeService(db);
afterAll(async () => { await db.course.deleteMany({ where: { id: { in: courses } } }); await db.$disconnect(); });
async function fixture() {
  const course = await db.course.create({ data: { title: 'Progress fixture', goal: 'Preserve leaf identity', preferences: defaultPreferences } }); courses.push(course.id);
  const topic = await db.topic.create({ data: { courseId: course.id, title: 'Leaf', kind: 'topic', position: 0, objectives: [] } }); return { course, topic };
}
it('rejects adding a child beneath a progress-only leaf through the SQL guard', async () => {
  const f = await fixture(); await db.learningProgress.create({ data: { topicId: f.topic.id, status: 'completed', completedAt: new Date() } });
  await expect(db.topic.create({ data: { id: randomUUID(), courseId: f.course.id, parentId: f.topic.id, title: 'Unsafe child', kind: 'topic', position: 0, objectives: [] } })).rejects.toThrow();
  expect(await db.learningProgress.count({ where: { topicId: f.topic.id } })).toBe(1);
});
it('keeps timestamps stable on repeated explicit completion and derives containers including ungenerated leaves', async () => {
  const f = await fixture(); expect(await progress.read(f.course.id)).toMatchObject({ totalLeaves: 1, completedLeaves: 0 });
  const first = await progress.patch(f.topic.id, { status: 'completed' }); expect(await progress.patch(f.topic.id, { status: 'completed' })).toEqual(first);
  const container = await tree.wrap(f.topic.id, { baseTreeRevision: 0, containerTitle: 'Module' });
  expect(await progress.read(f.course.id)).toMatchObject({ totalLeaves: 1, completedLeaves: 1 });
  expect((await db.learningProgress.findUniqueOrThrow({ where: { topicId: f.topic.id } })).completedAt?.toISOString()).toBe(first.completedAt);
  await expect(progress.patch(container.id, { status: 'completed' })).rejects.toMatchObject({ code: 'NOT_A_LEAF' });
  await expect(tree.add(f.course.id, { baseTreeRevision: 1, parentId: f.topic.id, title: 'Unsafe', kind: 'topic', position: 0, objectives: [] })).rejects.toMatchObject({ code: 'LEAF_HAS_PROGRESS' });
  await tree.add(f.course.id, { baseTreeRevision: 1, parentId: container.id, title: 'Ungenerated', kind: 'topic', position: 1, objectives: [] });
  expect(await progress.read(f.course.id)).toMatchObject({ totalLeaves: 2, completedLeaves: 1 });
  expect(await progress.patch(f.topic.id, { status: 'in_progress' })).toMatchObject({ completedAt: null });
  expect(await db.lesson.count({ where: { topic: { courseId: f.course.id } } })).toBe(0);
});
it('serializes progress against concurrent add and move without losing the owning progress record', async () => {
  for (const action of ['add', 'move'] as const) {
    const f = await fixture(); const moving = await tree.add(f.course.id, { baseTreeRevision: 0, parentId: null, title: 'Move me', kind: 'topic', position: 1, objectives: [] });
    const results = await Promise.allSettled([progress.patch(f.topic.id, { status: 'completed' }), action === 'add' ? tree.add(f.course.id, { baseTreeRevision: 1, parentId: f.topic.id, title: 'Child', kind: 'topic', position: 0, objectives: [] }) : tree.move(f.course.id, { baseTreeRevision: 1, topicId: moving.id, newParentId: f.topic.id, orderedSiblingIds: [moving.id] })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const children = await db.topic.count({ where: { parentId: f.topic.id } }); const owner = await db.learningProgress.findUnique({ where: { topicId: f.topic.id } }); expect(!!owner && children > 0).toBe(false);
  }
});
it('upgrades a populated valid fixture and aborts invalid historical data without repairing or deleting it', async () => {
  const initial = await readFile(new URL('../../prisma/migrations/20261018000100_initial/migration.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../../prisma/migrations/20261019000100_progress_leaf_guard/migration.sql', import.meta.url), 'utf8');
  const oldFunction = initial.slice(initial.indexOf('CREATE FUNCTION validate_topic_tree()'), initial.indexOf('CREATE TRIGGER topics_tree_guard')).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
  const newFunction = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION'), migration.indexOf('COMMIT;'));
  const preflight = migration.slice(migration.indexOf('DO $$'), migration.indexOf('CREATE OR REPLACE FUNCTION'));
  const f = await fixture(); const saved = await progress.patch(f.topic.id, { status: 'completed' });
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe(oldFunction); await tx.$executeRawUnsafe(preflight); await tx.$executeRawUnsafe(newFunction);
    expect((await tx.learningProgress.findUniqueOrThrow({ where: { topicId: f.topic.id } })).completedAt?.toISOString()).toBe(saved.completedAt);
  });
  await expect(db.$transaction(async tx => {
    await tx.$executeRawUnsafe(oldFunction);
    await tx.topic.create({ data: { courseId: f.course.id, parentId: f.topic.id, title: 'Historical invalid child', kind: 'topic', position: 0, objectives: [] } });
    await tx.$executeRawUnsafe(preflight);
  })).rejects.toThrow('Existing progress belongs to a container');
  expect(await db.topic.count({ where: { parentId: f.topic.id } })).toBe(0);
  expect(await progress.patch(f.topic.id, { status: 'completed' })).toEqual(saved);
});
