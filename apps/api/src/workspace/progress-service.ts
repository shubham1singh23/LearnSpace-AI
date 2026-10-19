import { courseProgressSchema, leafProgressSchema, progressPatchSchema, type ProgressStatus } from '@learnspace/shared';
import type { Database } from '../db.js';
import { HttpError } from '../errors.js';
import { lockCourse, transaction } from './transactions.js';

export function aggregateProgress(topics: { id: string; parentId: string | null }[], statuses: Map<string, ProgressStatus>) {
  const children = new Map<string | null, string[]>();
  for (const topic of topics) children.set(topic.parentId, [...(children.get(topic.parentId) ?? []), topic.id]);
  const totals = new Map<string, { completedLeaves: number; totalLeaves: number }>();
  const stack = (children.get(null) ?? []).map(id => ({ id, exit: false })); const seen = new Set<string>();
  while (stack.length) {
    const item = stack.pop()!; const descendants = children.get(item.id) ?? [];
    if (!item.exit) { if (seen.has(item.id)) throw new HttpError(409, 'INVALID_TREE', 'Invalid progress hierarchy.'); seen.add(item.id); stack.push({ id: item.id, exit: true }); for (const id of descendants) stack.push({ id, exit: false }); }
    else totals.set(item.id, descendants.length ? descendants.reduce((sum, id) => { const total = totals.get(id)!; return { completedLeaves: sum.completedLeaves + total.completedLeaves, totalLeaves: sum.totalLeaves + total.totalLeaves }; }, { completedLeaves: 0, totalLeaves: 0 }) : { completedLeaves: statuses.get(item.id) === 'completed' ? 1 : 0, totalLeaves: 1 });
  }
  if (seen.size !== topics.length) throw new HttpError(409, 'INVALID_TREE', 'Progress hierarchy is disconnected.');
  const course = (children.get(null) ?? []).reduce((sum, id) => { const total = totals.get(id)!; return { completedLeaves: sum.completedLeaves + total.completedLeaves, totalLeaves: sum.totalLeaves + total.totalLeaves }; }, { completedLeaves: 0, totalLeaves: 0 });
  return { totals, course, children };
}
export class ProgressService {
  constructor(private db: Database) {}
  async patch(topicId: string, raw: unknown) {
    const { status } = progressPatchSchema.parse(raw); const topic = await this.db.topic.findUnique({ where: { id: topicId }, select: { courseId: true } });
    if (!topic) throw new HttpError(404, 'NOT_FOUND', 'Topic not found.');
    return transaction(this.db, async tx => {
      await lockCourse(tx, topic.courseId);
      if (!await tx.topic.findUnique({ where: { id: topicId } })) throw new HttpError(404, 'NOT_FOUND', 'Topic not found.');
      if (await tx.topic.count({ where: { parentId: topicId } })) throw new HttpError(409, 'NOT_A_LEAF', 'Only leaves have explicit progress.');
      const prior = await tx.learningProgress.findUnique({ where: { topicId } });
      const row = prior?.status === status ? prior : await tx.learningProgress.upsert({ where: { topicId }, create: { topicId, status, completedAt: status === 'completed' ? new Date() : null }, update: { status, completedAt: status === 'completed' ? new Date() : null } });
      return leafProgressSchema.parse({ ...row, completedAt: row.completedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() });
    });
  }
  async read(courseId: string) {
    return transaction(this.db, async tx => {
      const course = await lockCourse(tx, courseId); const topics = await tx.topic.findMany({ where: { courseId }, take: 2001, include: { progress: true }, orderBy: { id: 'asc' } });
      if (topics.length > 2000) throw new HttpError(422, 'TREE_LIMIT', 'Progress supports up to 2000 topics.');
      const statuses = new Map(topics.map(topic => [topic.id, progressPatchSchema.parse({ status: topic.progress?.status ?? 'not_started' }).status]));
      const { totals, course: counts, children } = aggregateProgress(topics, statuses);
      return courseProgressSchema.parse({ treeRevision: course.treeRevision, ...counts, topics: topics.map(topic => children.has(topic.id) ? { isLeaf: false, topicId: topic.id, ...totals.get(topic.id)! } : { isLeaf: true, progress: { topicId: topic.id, status: statuses.get(topic.id)!, completedAt: topic.progress?.completedAt?.toISOString() ?? null, updatedAt: topic.progress?.updatedAt.toISOString() ?? null }, ...totals.get(topic.id)! }) });
    });
  }
}
