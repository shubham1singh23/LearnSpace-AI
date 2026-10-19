import { generateEdit } from '@learnspace/ai';
import { canonicalJSON, captureSelection, editRequestSchema, selectionRequest, tiptapDocumentSchema, transformEdit, SelectionError } from '@learnspace/shared';
import { HttpError } from '../errors.js';
import { OperationService } from './operations.js';

const clip = (text: string, size: number) => Array.from(text).slice(0, size).join('');
export class EditService {
  constructor(readonly operations: OperationService) {}
  async start(lessonId: string, key: string, raw: unknown) {
    const request = editRequestSchema.parse(raw);
    const owner = await this.operations.db.lesson.findUnique({ where: { id: lessonId }, select: { topic: { select: { courseId: true } } } });
    if (!owner) throw new HttpError(404, 'NOT_FOUND', 'Lesson not found.');
    return this.operations.start({ courseId: owner.topic.courseId, ownerId: lessonId, kind: 'edit', idempotencyKey: key, request, retryOfOperationId: request.retryOfOperationId, promptVersion: 'selection-edit-v1', capture: async tx => {
      await tx.$queryRaw`SELECT id FROM lessons WHERE id = ${lessonId}::uuid FOR UPDATE`;
      const lesson = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId }, include: { topic: { include: { course: true } } } });
      if (lesson.revision !== request.baseRevision) throw new HttpError(409, 'REVISION_CONFLICT', 'Save current notes before capturing a selection.', false, { currentRevision: lesson.revision });
      const document = tiptapDocumentSchema.parse(lesson.document);
      let target;
      try { target = await captureSelection(document, request.baseRevision, request.target.from, request.target.to); }
      catch (error) { if (error instanceof SelectionError) throw new HttpError(422, error.code, error.message); throw error; }
      if (canonicalJSON(selectionRequest(target)) !== canonicalJSON(request.target)) throw new HttpError(409, 'TARGET_MISMATCH', 'Selection IDs or hash do not match saved notes.');
      const course = lesson.topic.course;
      const plain = (value: typeof document.content[number]): string => value.text ?? value.content?.map(plain).join(' ') ?? '';
      const contains = (node: typeof document.content[number]): boolean => target.blockIds.includes(String(node.attrs?.blockId)) || !!node.content?.some(contains);
      const index = document.content.findIndex(contains);
      const adjacent = document.content.slice(Math.max(0, index - 1), index + 2).filter(node => !target.blockIds.includes(String(node.attrs?.blockId)));
      // Include the selected block's unselected prefix/suffix as context too.
      // The exact selected text remains a separate mandatory prompt field.
      const neighbours = [...target.blocks, ...adjacent].map(plain).filter(Boolean);
      const excerpt = clip(neighbours.join('\n'), 1200); const goal = clip(course.goal, 1200);
      const omittedNode = (node: typeof document.content[number]): boolean => ['image', 'mathInline', 'mathBlock'].includes(node.type) || !!node.content?.some(omittedNode);
      const context = { sources: [{ lessonId, revision: lesson.revision, blockIds: [...new Set([...target.blockIds, ...adjacent.map(node => String(node.attrs?.blockId))])] }], omitted: document.content.length > target.blocks.length + adjacent.length || neighbours.join('\n').length > excerpt.length || course.goal.length > goal.length || document.content.some(omittedNode) };
      const edges = await tx.topicPrerequisite.findMany({ where: { topicId: lesson.topicId }, take: 4, orderBy: { prerequisiteId: 'asc' }, include: { prerequisite: { include: { lesson: true } } } });
      if (edges.length > 3) context.omitted = true;
      const prerequisites = edges.slice(0, 3).map(edge => {
        const saved = edge.prerequisite.lesson; if (!saved) return { title: edge.prerequisite.title, choice: edge.choice, text: 'No saved prerequisite notes.' };
        const prior = tiptapDocumentSchema.parse(saved.document); const text = prior.content.map(plain).join('\n');
        context.sources.push({ lessonId: saved.id, revision: saved.revision, blockIds: prior.content.map(node => String(node.attrs?.blockId)) });
        if (Array.from(text).length > 500) context.omitted = true;
        return { title: edge.prerequisite.title, choice: edge.choice, text: clip(text, 500) };
      });
      return { lessonId, topicId: lesson.topicId, baseRevision: lesson.revision, baseTreeRevision: course.treeRevision, target, document, context, input: JSON.stringify({ goal, topic: lesson.topic.title, objectives: lesson.topic.objectives, preferences: course.preferences, surroundingText: excerpt, prerequisites }) };
    } }, async (adapter, capture, signal) => {
      const prepared = await generateEdit(adapter, request, capture.target!, capture.input, signal);
      await transformEdit(capture.document!, prepared);
      return { type: 'edit', readyAt: new Date().toISOString(), prepared };
    });
  }
}
