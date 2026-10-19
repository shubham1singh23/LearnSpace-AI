import { compileLesson, structured, teachingPolicy } from '@learnspace/ai';
import { randomUUID } from 'node:crypto';
import { educationalLessonSchema, lessonGenerationSchema, operationResultSchema, regenerationSchema, syllabusCommitSchema, syllabusDraftSchema, syllabusGenerationSchema } from '@learnspace/shared';
import { HttpError } from '../errors.js';
import { lockCourse, transaction } from '../workspace/transactions.js';
import { documentJSON, hashJSON, lessonDTO, LessonService } from '../workspace/lesson-service.js';
import { json, type OperationService } from './operations.js';
import { lessonContext } from './context.js';

export const lessonPolicy = `${teachingPolicy} Return an educational lesson JSON: {title, objectives:string[], prerequisiteNotes:string[], sections:[{heading,blocks:TeachingBlock[]}], recall:[{question,answer}], uncertainties:string[], sources?:[{title,url}]}. Each TeachingBlock has type paragraph/example/analogy/reflection with text; list with ordered:boolean and items:string[]; code with language,text; math with latex; or table with headers:string[] and rectangular rows:string[][]. Include at least one useful worked example (type example), clear explanation and active recall question/answer. Respect preferences, but a useful example is mandatory. Do not emit Tiptap nodes, IDs, images, raw HTML or invented references. Keep output compact within the configured output limit.`;

export class GenerationService {
  constructor(readonly operations: OperationService) {}
  async regenerate(lessonId: string, key: string, raw: unknown) {
    const input = regenerationSchema.parse(raw);
    const lesson = await this.operations.db.lesson.findUnique({ where: { id: lessonId }, include: { topic: true } }); if (!lesson) throw new HttpError(404, 'NOT_FOUND', 'Lesson not found.');
    return this.operations.start({ courseId: lesson.topic.courseId, kind: 'regeneration', ownerId: lessonId, idempotencyKey: key, request: input, retryOfOperationId: input.retryOfOperationId, capture: async tx => {
      await tx.$queryRaw`SELECT id FROM lessons WHERE id = ${lessonId}::uuid FOR UPDATE`;
      const current = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId } });
      if (current.revision !== input.baseRevision) throw new HttpError(409, 'REVISION_CONFLICT', 'Save and reload the current lesson before regeneration.', false, { currentRevision: current.revision });
      return lessonContext(tx, current.topicId, input.instruction, lessonId);
    } }, async (adapter, captured, signal) => {
      const output = await structured(adapter, `${lessonPolicy} Propose a complete replacement using the saved edited notes as context. The user must review and explicitly accept; do not assume acceptance.`, captured.input, educationalLessonSchema, signal);
      const document = compileLesson(output);
      return { type: 'lesson', readyAt: new Date().toISOString(), documentSchemaVersion: 1, document, contentHash: hashJSON(document) };
    });
  }
  async commitRegeneration(id: string, raw: unknown) { await this.operations.reconcile(); return new LessonService(this.operations.db).regenerate(id, raw); }
  async initial(topicId: string, key: string, raw: unknown) {
    const input = lessonGenerationSchema.parse(raw);
    const existing = await this.operations.db.lesson.findUnique({ where: { topicId } }); if (existing) return { lesson: lessonDTO(existing) };
    const topic = await this.operations.db.topic.findUnique({ where: { id: topicId } }); if (!topic) throw new HttpError(404, 'NOT_FOUND', 'Topic not found.');
    const operation = await this.operations.start({ courseId: topic.courseId, kind: 'initial_lesson', ownerId: topicId, idempotencyKey: key, request: input, retryOfOperationId: input.retryOfOperationId, capture: async tx => {
      if (await tx.lesson.findUnique({ where: { topicId } })) throw new HttpError(409, 'LESSON_EXISTS', 'Saved notes already exist. Reload them.');
      return lessonContext(tx, topicId, input.instruction);
    } }, async (adapter, captured, signal, running) => {
      const lesson = await structured(adapter, lessonPolicy, captured.input, educationalLessonSchema, signal); const document = compileLesson(lesson);
      if (signal.aborted) throw new HttpError(409, 'EXECUTION_INTERRUPTED', 'Generation was interrupted.');
      return transaction(this.operations.db, async tx => {
        const course = await lockCourse(tx, topic.courseId);
        await tx.$queryRaw`SELECT id FROM ai_operations WHERE id = ${running.id}::uuid FOR UPDATE`;
        const current = await tx.aiOperation.findUniqueOrThrow({ where: { id: running.id } });
        if (signal.aborted || current.status !== 'running' || current.ownerToken !== running.ownerToken || !current.leaseUntil || current.leaseUntil <= new Date()) throw new HttpError(409, 'EXECUTION_INTERRUPTED', 'Operation ownership expired.');
        if (course.treeRevision !== captured.baseTreeRevision || await tx.topic.count({ where: { parentId: topicId } })) throw new HttpError(409, 'STALE_CONTEXT', 'The topic context changed while generating.');
        if (await tx.lesson.findUnique({ where: { topicId } })) throw new HttpError(409, 'LESSON_EXISTS', 'Manual notes were created while generating.');
        const saved = await tx.lesson.create({ data: { topicId, document: documentJSON(document), contentHash: hashJSON(document), source: 'initial_ai', operationId: running.id } });
        if (signal.aborted || current.leaseUntil <= new Date()) throw new HttpError(409, 'EXECUTION_INTERRUPTED', 'Operation deadline expired before commit.');
        const result = { type: 'applied_lesson' as const, lessonId: saved.id, revision: saved.revision };
        await tx.aiOperation.update({ where: { id: running.id }, data: { status: 'applied', result: json(result), lessonId: saved.id, ownerToken: null, leaseUntil: null } });
        if (signal.aborted || current.leaseUntil <= new Date()) throw new HttpError(409, 'EXECUTION_INTERRUPTED', 'Operation deadline expired before commit.'); return result;
      });
    });
    return { operation };
  }
  async commitSyllabus(courseId: string, raw: unknown) {
    const input = syllabusCommitSchema.parse(raw); const draftHash = hashJSON(input.draft);
    await this.operations.reconcile();
    return transaction(this.operations.db, async tx => {
      const course = await lockCourse(tx, courseId);
      await tx.$queryRaw`SELECT id FROM ai_operations WHERE id = ${input.operationId}::uuid FOR UPDATE`;
      const operation = await tx.aiOperation.findUnique({ where: { id: input.operationId } });
      if (!operation || operation.courseId !== courseId || operation.kind !== 'syllabus') throw new HttpError(404, 'NOT_FOUND', 'Syllabus operation not found in this course.');
      const result = operationResultSchema.safeParse(operation.result);
      if (operation.status === 'applied' && result.success && result.data.type === 'applied_syllabus') {
        if (result.data.draftHash !== draftHash || operation.baseTreeRevision !== input.baseTreeRevision) throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'This operation already committed a different reviewed draft.');
        return result.data;
      }
      if (operation.status !== 'ready' || !result.success || result.data.type !== 'syllabus') throw new HttpError(409, 'OPERATION_NOT_READY', 'This syllabus is no longer available for commit.');
      if (operation.baseTreeRevision !== input.baseTreeRevision || course.treeRevision !== input.baseTreeRevision) throw new HttpError(409, 'STALE_CONTEXT', 'The course changed after generation. Generate a new syllabus.');
      if (await tx.topic.count({ where: { courseId } })) throw new HttpError(409, 'TREE_NOT_EMPTY', 'A syllabus cannot replace existing topics.');
      const ids = new Map(input.draft.nodes.map(node => [node.tempId, randomUUID()]));
      const inserted = new Set<string>(); let remaining = [...input.draft.nodes];
      while (remaining.length) {
        const batch = remaining.filter(node => node.parentTempId === null || inserted.has(node.parentTempId));
        if (!batch.length) throw new HttpError(422, 'INVALID_SYLLABUS', 'Syllabus hierarchy cannot be resolved.');
        await tx.topic.createMany({ data: batch.map(node => ({ id: ids.get(node.tempId)!, courseId, parentId: node.parentTempId === null ? null : ids.get(node.parentTempId)!, title: node.title, kind: node.kind, position: node.position, objectives: node.objectives })) });
        for (const node of batch) inserted.add(node.tempId); remaining = remaining.filter(node => !inserted.has(node.tempId));
      }
      if (input.draft.prerequisites.length) await tx.topicPrerequisite.createMany({ data: input.draft.prerequisites.map(edge => ({ courseId, topicId: ids.get(edge.topicTempId)!, prerequisiteId: ids.get(edge.prerequisiteTempId)! })) });
      const updated = await tx.course.update({ where: { id: courseId }, data: { treeRevision: { increment: 1 } } });
      const applied = { type: 'applied_syllabus' as const, courseId, treeRevision: updated.treeRevision, draftHash, topicIds: [...ids.values()] };
      await tx.aiOperation.update({ where: { id: operation.id }, data: { status: 'applied', result: json(applied) } }); return applied;
    });
  }
  async syllabus(courseId: string, key: string, raw: unknown) {
    const input = syllabusGenerationSchema.parse(raw);
    return this.operations.start({ courseId, kind: 'syllabus', ownerId: courseId, idempotencyKey: key, request: input, retryOfOperationId: input.retryOfOperationId,
      capture: async tx => {
        const course = await lockCourse(tx, courseId, input.baseTreeRevision);
        if (await tx.topic.count({ where: { courseId } })) throw new HttpError(409, 'TREE_NOT_EMPTY', 'Syllabus generation requires an empty course tree. Existing topics remain editable manually.');
        return { baseTreeRevision: course.treeRevision, context: { sources: [], omitted: false }, input: JSON.stringify({ goal: course.goal, title: course.title, preferences: course.preferences, instruction: input.instruction }) };
      }
    }, async (adapter, captured, signal) => {
      const draft = await structured(adapter, `${teachingPolicy} Create a syllabus only, never lessons. JSON shape: {"nodes":[{"tempId":"unique_id","parentTempId":null,"title":"...","kind":"module|topic|subtopic","position":0,"objectives":["..."]}],"prerequisites":[{"topicTempId":"...","prerequisiteTempId":"..."}]}. Use unique alphanumeric/underscore/hyphen tempIds, complete parent references, contiguous zero-based sibling positions, no hierarchy or prerequisite cycles, and teaching objectives on every leaf. Maximum 2000 nodes, 8000 edges; prefer a compact teachable plan.`, captured.input, syllabusDraftSchema, signal);
      return { type: 'syllabus', readyAt: new Date().toISOString(), draft };
    });
  }
}
