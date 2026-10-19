import { courseSchema, topicSchema, treeSchema } from '@learnspace/shared';
import type { Database } from '../db.js';
import { HttpError } from '../errors.js';
import { lockCourse, transaction, type Transaction } from './transactions.js';
import type { Topic } from '../generated/prisma/client.js';

export const courseDTO = (value: { id: string; title: string; goal: string; preferences: unknown; treeRevision: number; createdAt: Date; updatedAt: Date }) => courseSchema.parse({ ...value, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() });
async function rows(tx: Transaction, courseId: string) { return tx.topic.findMany({ where: { courseId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }); }
function parentCheck(topics: Topic[], parentId: string | null) {
  if (parentId !== null && !topics.some(topic => topic.id === parentId)) throw new HttpError(422, 'INVALID_PARENT', 'Parent must belong to this course.');
}
function exactOrder(expected: string[], actual: string[]) {
  if (expected.length !== actual.length || actual.some(id => !expected.includes(id))) throw new HttpError(422, 'INVALID_ORDER', 'Supply the complete sibling set.');
}
async function park(tx: Transaction, topics: Topic[]) {
  // Partial unique indexes are immediate: park every row before assigning dense order.
  const maximum = Math.max(0, ...topics.map(topic => topic.position));
  for (const [index, topic] of topics.entries()) await tx.topic.update({ where: { id: topic.id }, data: { position: maximum + 2001 + index } });
}
async function dense(tx: Transaction, topics: Topic[]) {
  const positions = new Map<string | null, number>();
  for (const topic of topics) {
    const position = positions.get(topic.parentId) ?? 0;
    await tx.topic.update({ where: { id: topic.id }, data: { position } });
    positions.set(topic.parentId, position + 1);
  }
}
export async function treeDTO(tx: Transaction, courseId: string) {
  const course = await tx.course.findUniqueOrThrow({ where: { id: courseId } });
  const topics = await tx.topic.findMany({ where: { courseId }, include: { lesson: { select: { id: true } } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  const prerequisites = await tx.topicPrerequisite.findMany({ where: { courseId }, select: { topicId: true, prerequisiteId: true, choice: true } });
  return treeSchema.parse({ treeRevision: course.treeRevision, topics: topics.map(({ lesson, ...topic }) => topicSchema.parse({ ...topic, isLeaf: !topics.some(child => child.parentId === topic.id), ...(lesson ? { lessonId: lesson.id } : {}) })), prerequisites });
}
export class TreeService {
  constructor(private db: Database) {}
  async read(courseId: string) { return transaction(this.db, async tx => { await lockCourse(tx, courseId); return treeDTO(tx, courseId); }); }
  async topicCourse(id: string) {
    const topic = await this.db.topic.findUnique({ where: { id } });
    if (!topic) throw new HttpError(404, 'NOT_FOUND', 'Topic not found.');
    return topic.courseId;
  }
  async mutate(courseId: string, revision: number | undefined, work: (tx: Transaction, topics: Topic[]) => Promise<void>) {
    return transaction(this.db, async tx => {
      await lockCourse(tx, courseId, revision);
      await work(tx, await rows(tx, courseId));
      await tx.course.update({ where: { id: courseId }, data: { treeRevision: { increment: 1 } } });
      return treeDTO(tx, courseId);
    });
  }
  async add(courseId: string, input: { baseTreeRevision: number; parentId: string | null; title: string; kind: string; position: number; objectives: string[] }) {
    let createdId = '';
    const tree = await this.mutate(courseId, input.baseTreeRevision, async (tx, topics) => {
      if (topics.length >= 2000) throw new HttpError(422, 'TREE_LIMIT', 'Course topic limit reached.');
      parentCheck(topics, input.parentId);
      if (input.parentId && await tx.lesson.count({ where: { topicId: input.parentId } })) throw new HttpError(409, 'LEAF_HAS_LESSON', 'Use Wrap to preserve this lesson before adding children.');
      if (input.parentId && await tx.learningProgress.count({ where: { topicId: input.parentId } })) throw new HttpError(409, 'LEAF_HAS_PROGRESS', 'Use Wrap to preserve this leaf progress before adding children.');
      const siblings = topics.filter(topic => topic.parentId === input.parentId);
      if (input.position > siblings.length) throw new HttpError(422, 'INVALID_ORDER', 'Position exceeds sibling count.');
      await park(tx, topics);
      const created = await tx.topic.create({ data: { courseId, parentId: input.parentId, title: input.title, kind: input.kind, objectives: input.objectives, position: 10000000 } });
      createdId = created.id;
      siblings.splice(input.position, 0, created);
      await dense(tx, [...topics.filter(topic => topic.parentId !== input.parentId), ...siblings]);
    });
    return { ...tree.topics.find(topic => topic.id === createdId)!, treeRevision: tree.treeRevision };
  }
  async order(courseId: string, input: { baseTreeRevision: number; parentId: string | null; orderedSiblingIds: string[] }) {
    return this.mutate(courseId, input.baseTreeRevision, async (tx, topics) => {
      parentCheck(topics, input.parentId);
      exactOrder(topics.filter(topic => topic.parentId === input.parentId).map(topic => topic.id), input.orderedSiblingIds);
      await park(tx, topics);
      await dense(tx, [...topics.filter(topic => topic.parentId !== input.parentId), ...input.orderedSiblingIds.map(id => topics.find(topic => topic.id === id)!)]);
    });
  }
  async move(courseId: string, input: { baseTreeRevision: number; topicId: string; newParentId: string | null; orderedSiblingIds: string[] }) {
    return this.mutate(courseId, input.baseTreeRevision, async (tx, topics) => {
      const topic = topics.find(topic => topic.id === input.topicId);
      if (!topic) throw new HttpError(404, 'NOT_FOUND', 'Topic not found.');
      parentCheck(topics, input.newParentId);
      if (input.newParentId && await tx.lesson.count({ where: { topicId: input.newParentId } })) throw new HttpError(409, 'LEAF_HAS_LESSON', 'Use Wrap to preserve this lesson before adding children.');
      if (input.newParentId && await tx.learningProgress.count({ where: { topicId: input.newParentId } })) throw new HttpError(409, 'LEAF_HAS_PROGRESS', 'Use Wrap to preserve this leaf progress before adding children.');
      let ancestor = input.newParentId;
      while (ancestor) {
        if (ancestor === topic.id) throw new HttpError(422, 'TREE_CYCLE', 'A topic cannot be moved beneath itself.');
        ancestor = topics.find(item => item.id === ancestor)?.parentId ?? null;
      }
      exactOrder([...topics.filter(item => item.parentId === input.newParentId && item.id !== topic.id).map(item => item.id), topic.id], input.orderedSiblingIds);
      await park(tx, topics);
      await tx.topic.update({ where: { id: topic.id }, data: { parentId: input.newParentId } });
      topic.parentId = input.newParentId;
      await dense(tx, [...topics.filter(item => item.parentId !== input.newParentId), ...input.orderedSiblingIds.map(id => topics.find(item => item.id === id)!)]);
    });
  }
  async wrap(id: string, input: { baseTreeRevision: number; containerTitle: string }) {
    let containerId = '';
    const tree = await this.mutate(await this.topicCourse(id), input.baseTreeRevision, async (tx, topics) => {
      if (topics.length >= 2000) throw new HttpError(422, 'TREE_LIMIT', 'Course topic limit reached.');
      const original = topics.find(topic => topic.id === id);
      if (!original) throw new HttpError(404, 'NOT_FOUND', 'Topic not found.');
      await park(tx, topics);
      const container = await tx.topic.create({ data: { courseId: original.courseId, parentId: original.parentId, position: 10000000, title: input.containerTitle, kind: 'module', objectives: [] } });
      containerId = container.id;
      await tx.topic.update({ where: { id }, data: { parentId: container.id, position: 10000001 } });
      await dense(tx, topics.flatMap(topic => topic.id === id ? [container, { ...original, parentId: container.id }] : [topic]));
    });
    return { ...tree.topics.find(topic => topic.id === containerId)!, treeRevision: tree.treeRevision };
  }
  async remove(id: string, revision: number) {
    return this.mutate(await this.topicCourse(id), revision, async (tx, topics) => {
      const removed = new Set([id]);
      for (let size = -1; size !== removed.size;) { size = removed.size; for (const topic of topics) if (topic.parentId && removed.has(topic.parentId)) removed.add(topic.id); }
      await tx.lesson.deleteMany({ where: { topicId: { in: [...removed] } } });
      await tx.topic.delete({ where: { id } });
      const remaining = topics.filter(topic => !removed.has(topic.id));
      await park(tx, remaining); await dense(tx, remaining);
    });
  }
}
