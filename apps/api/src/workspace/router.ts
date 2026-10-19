import { Router } from 'express';
import { z } from 'zod';
import { choiceSchema, createCourseSchema, createTopicSchema, deleteCourseSchema, deleteTopicSchema, idSchema, moveTopicSchema, orderTopicsSchema, patchCourseSchema, patchTopicSchema, prerequisitesSchema, wrapTopicSchema, createLessonSchema, saveLessonSchema, restoreLessonSchema } from '@learnspace/shared';
import type { Database } from '../db.js';
import { HttpError } from '../errors.js';
import { TreeService, courseDTO } from './tree-service.js';
import { lockCourse, transaction } from './transactions.js';
import { LessonService } from './lesson-service.js';

export function workspaceRouter(db: Database) {
  const router = Router();
  const service = new TreeService(db);
  const lessons = new LessonService(db);
  router.get('/topics/:id/lesson', async (req, res) => { res.json({ data: await lessons.load(idSchema.parse(req.params.id)), requestId: res.locals.requestId }); });
  router.post('/topics/:id/lessons', async (req, res) => { res.status(201).json({ data: await lessons.create(idSchema.parse(req.params.id), createLessonSchema.parse(req.body)), requestId: res.locals.requestId }); });
  router.put('/lessons/:id', async (req, res) => { res.json({ data: await lessons.save(idSchema.parse(req.params.id), saveLessonSchema.parse(req.body)), requestId: res.locals.requestId }); });
  router.post('/lessons/:id/restores', async (req, res) => { res.json({ data: await lessons.restore(idSchema.parse(req.params.id), restoreLessonSchema.parse(req.body)), requestId: res.locals.requestId }); });
  router.get('/lessons/:id/versions', async (req, res) => {
    const query = z.object({ cursor: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse(req.query);
    res.json({ data: await lessons.versions(idSchema.parse(req.params.id), query.cursor, query.limit), requestId: res.locals.requestId });
  });
  router.get('/lessons/:id/versions/:revision', async (req, res) => { res.json({ data: await lessons.version(idSchema.parse(req.params.id), z.coerce.number().int().positive().parse(req.params.revision)), requestId: res.locals.requestId }); });
  router.get('/courses', async (req, res) => {
    const query = z.object({ cursor: idSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse(req.query);
    const courses = await db.course.findMany({ take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}), orderBy: { id: 'asc' } });
    const visible = courses.slice(0, query.limit);
    res.json({ data: visible.map(courseDTO), page: { nextCursor: courses.length > query.limit ? visible.at(-1)?.id : null }, requestId: res.locals.requestId });
  });
  router.post('/courses', async (req, res) => {
    const input = createCourseSchema.parse(req.body);
    res.status(201).json({ data: courseDTO(await db.course.create({ data: input })), requestId: res.locals.requestId });
  });
  router.get('/courses/:id', async (req, res) => {
    const data = await db.course.findUnique({ where: { id: idSchema.parse(req.params.id) } });
    if (!data) throw new HttpError(404, 'NOT_FOUND', 'Course not found.');
    res.json({ data: courseDTO(data), requestId: res.locals.requestId });
  });
  router.patch('/courses/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id); const { baseTreeRevision, ...changes } = patchCourseSchema.parse(req.body);
    const data = await transaction(db, async tx => { await lockCourse(tx, id, baseTreeRevision); return tx.course.update({ where: { id }, data: { ...changes, treeRevision: { increment: 1 } } }); });
    res.json({ data: courseDTO(data), requestId: res.locals.requestId });
  });
  router.delete('/courses/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id); const input = deleteCourseSchema.parse(req.body);
    await transaction(db, async tx => {
      await lockCourse(tx, id, input.baseTreeRevision);
      if (await tx.exportLease.count({ where: { courseId: id } })) throw new HttpError(409, 'EXPORT_IN_PROGRESS', 'Course is protected by an export lease.');
      await tx.lesson.deleteMany({ where: { topic: { courseId: id } } });
      await tx.course.delete({ where: { id } });
    });
    res.status(204).end();
  });
  router.get('/courses/:id/tree', async (req, res) => { res.json({ data: await service.read(idSchema.parse(req.params.id)), requestId: res.locals.requestId }); });
  router.post('/courses/:id/topics', async (req, res) => {
    const data = await service.add(idSchema.parse(req.params.id), createTopicSchema.parse(req.body));
    res.status(201).json({ data, requestId: res.locals.requestId });
  });
  router.patch('/topics/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id); const { baseTreeRevision, ...changes } = patchTopicSchema.parse(req.body);
    const data = await service.mutate(await service.topicCourse(id), baseTreeRevision, async tx => { await tx.topic.update({ where: { id }, data: changes }); });
    res.json({ data: { ...data.topics.find(topic => topic.id === id), treeRevision: data.treeRevision }, requestId: res.locals.requestId });
  });
  router.post('/courses/:id/topic-moves', async (req, res) => { const data = await service.move(idSchema.parse(req.params.id), moveTopicSchema.parse(req.body)); res.json({ data: { treeRevision: data.treeRevision }, requestId: res.locals.requestId }); });
  router.put('/courses/:id/topic-order', async (req, res) => { const data = await service.order(idSchema.parse(req.params.id), orderTopicsSchema.parse(req.body)); res.json({ data: { treeRevision: data.treeRevision }, requestId: res.locals.requestId }); });
  router.post('/topics/:id/wrap', async (req, res) => { res.status(201).json({ data: await service.wrap(idSchema.parse(req.params.id), wrapTopicSchema.parse(req.body)), requestId: res.locals.requestId }); });
  router.delete('/topics/:id', async (req, res) => { await service.remove(idSchema.parse(req.params.id), deleteTopicSchema.parse(req.body).baseTreeRevision); res.status(204).end(); });
  router.put('/topics/:id/prerequisites', async (req, res) => {
    const id = idSchema.parse(req.params.id); const input = prerequisitesSchema.parse(req.body); const courseId = await service.topicCourse(id);
    const data = await service.mutate(courseId, input.baseTreeRevision, async (tx, topics) => {
      if (input.prerequisiteIds.some(target => target === id || !topics.some(topic => topic.id === target))) throw new HttpError(422, 'INVALID_PREREQUISITE', 'Prerequisites must be other topics in this course.');
      const edges = await tx.topicPrerequisite.findMany({ where: { courseId, topicId: { not: id } } });
      const pending = [...input.prerequisiteIds]; const visited = new Set<string>();
      while (pending.length) {
        const target = pending.pop()!;
        if (target === id) throw new HttpError(409, 'PREREQUISITE_CYCLE', 'Prerequisites cannot form a cycle.');
        if (visited.has(target)) continue;
        visited.add(target);
        pending.push(...edges.filter(edge => edge.topicId === target).map(edge => edge.prerequisiteId));
      }
      const previous = await tx.topicPrerequisite.findMany({ where: { topicId: id } });
      await tx.topicPrerequisite.deleteMany({ where: { topicId: id } });
      for (const prerequisiteId of input.prerequisiteIds) await tx.topicPrerequisite.create({ data: { courseId, topicId: id, prerequisiteId, choice: previous.find(edge => edge.prerequisiteId === prerequisiteId)?.choice ?? 'undecided' } });
    });
    res.json({ data: { treeRevision: data.treeRevision, prerequisites: data.prerequisites.filter(edge => edge.topicId === id) }, requestId: res.locals.requestId });
  });
  router.patch('/topics/:id/prerequisites/:prerequisiteId', async (req, res) => {
    const id = idSchema.parse(req.params.id); const prerequisiteId = idSchema.parse(req.params.prerequisiteId); const input = choiceSchema.parse(req.body);
    const data = await service.mutate(await service.topicCourse(id), undefined, async tx => { await tx.topicPrerequisite.update({ where: { topicId_prerequisiteId: { topicId: id, prerequisiteId } }, data: input }); });
    res.json({ data: { ...data.prerequisites.find(edge => edge.topicId === id && edge.prerequisiteId === prerequisiteId), treeRevision: data.treeRevision }, requestId: res.locals.requestId });
  });
  return router;
}
