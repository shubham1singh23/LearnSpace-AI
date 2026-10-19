import { tiptapDocumentSchema, type ContextManifest, type DocumentNode } from '@learnspace/shared';
import type { Transaction } from '../workspace/transactions.js';
import { HttpError } from '../errors.js';
import type { CapturedOperation } from './operations.js';

export async function lessonContext(tx: Transaction, topicId: string, instruction?: string, lessonId?: string): Promise<CapturedOperation> {
  const topic = await tx.topic.findUnique({ where: { id: topicId } }); if (!topic) throw new HttpError(404, 'NOT_FOUND', 'Topic not found.');
  const course = await tx.course.findUniqueOrThrow({ where: { id: topic.courseId } });
  if (await tx.topic.count({ where: { parentId: topicId } })) throw new HttpError(409, 'NOT_A_LEAF', 'Only teaching leaves can generate notes.');
  const context: ContextManifest = { sources: [], omitted: false };
  const clip = (value: string, limit: number) => { if (Buffer.byteLength(value) <= limit) return value; context.omitted = true; return Buffer.from(value).subarray(0, limit).toString('utf8'); };
  const topics = await tx.topic.findMany({ where: { courseId: course.id }, select: { id: true, parentId: true, title: true } });
  const byId = new Map(topics.map(row => [row.id, row])); const path: string[] = []; let parent: string | null = topicId;
  while (parent) { const entry = byId.get(parent); if (!entry || path.length >= 2000) throw new HttpError(409, 'INVALID_TREE', 'Topic path cannot be resolved.'); path.unshift(entry.title); parent = entry.parentId; }
  const edges = await tx.topicPrerequisite.findMany({ where: { topicId }, orderBy: { prerequisiteId: 'asc' }, take: 4, include: { prerequisite: { include: { lesson: true } } } });
  if (edges.length > 3) context.omitted = true;
  const notes: { topic: string; choice: string; text: string }[] = [];
  const include = (lesson: { id: string; revision: number; document: unknown }, title: string, choice: string) => {
    const document = tiptapDocumentSchema.parse(lesson.document); const blockIds: string[] = []; const parts: string[] = []; let remaining = 1000;
    const plain = (node: DocumentNode): string => {
      if (node.type === 'image') { context.omitted = true; return ''; }
      if (typeof node.attrs?.latex === 'string') return node.attrs.latex;
      return node.text ?? node.content?.map(plain).join(' ') ?? '';
    };
    for (const node of document.content) {
      const value = plain(node); if (!value.trim()) continue;
      if (Buffer.byteLength(value) > remaining) { context.omitted = true; break; }
      parts.push(value); remaining -= Buffer.byteLength(value);
      if (typeof node.attrs?.blockId === 'string') blockIds.push(node.attrs.blockId);
    }
    context.sources.push({ lessonId: lesson.id, revision: lesson.revision, blockIds }); notes.push({ topic: title, choice, text: parts.join('\n') });
  };
  let baseRevision: number | undefined;
  if (lessonId) { const lesson = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId } }); baseRevision = lesson.revision; include(lesson, topic.title, 'current edited notes'); }
  for (const edge of edges.slice(0, 3)) if (edge.prerequisite.lesson) include(edge.prerequisite.lesson, edge.prerequisite.title, edge.choice);
  return { topicId, lessonId, baseRevision, baseTreeRevision: course.treeRevision, context, input: JSON.stringify({ goal: clip(course.goal, 2000), preferences: course.preferences, path: clip(path.join(' / '), 1000), objectives: topic.objectives, instruction, savedNotes: notes }) };
}
