import { createHash } from 'node:crypto';
import { createLessonSchema, lessonSchema, operationResultSchema, receiptSchema, regenerationCommitSchema, restoreLessonSchema, saveLessonSchema, tiptapDocumentSchema, versionSchema, versionsSchema, type DocumentNode, type TiptapDocument } from '@learnspace/shared';
import type { z } from 'zod';
import type { Database } from '../db.js';
import type { Lesson, Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { lockCourse, transaction, type Transaction } from './transactions.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hashJSON = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function documentJSON(node: DocumentNode): Prisma.InputJsonObject {
  return { type: node.type, ...(node.attrs ? { attrs: node.attrs } : {}), ...(node.text === undefined ? {} : { text: node.text }),
    ...(node.marks ? { marks: node.marks.map(mark => ({ type: mark.type, ...(mark.attrs ? { attrs: mark.attrs } : {}) })) } : {}),
    ...(node.content ? { content: node.content.map(documentJSON) } : {}) };
}
export const lessonDTO = (lesson: Omit<Lesson, 'document'> & { document: unknown }) => lessonSchema.parse({ id: lesson.id, topicId: lesson.topicId, revision: lesson.revision, documentSchemaVersion: lesson.documentSchemaVersion, document: lesson.document, updatedAt: lesson.updatedAt.toISOString() });
export function assetIds(document: TiptapDocument) {
  const ids = new Set<string>();
  const visit = (node: TiptapDocument | TiptapDocument['content'][number]) => { if (node.type === 'image' && typeof node.attrs?.assetId === 'string') ids.add(node.attrs.assetId); node.content?.forEach(visit); };
  visit(document); return [...ids];
}
async function validateAssets(tx: Transaction, courseId: string, document: TiptapDocument) {
  const ids = assetIds(document);
  if (await tx.asset.count({ where: { id: { in: ids }, courseId, state: 'ready' } }) !== ids.length) throw new HttpError(409, 'ASSET_UNAVAILABLE', 'An image is unavailable or belongs to another course.');
  return ids;
}
function receipt(lessonId: string, mutationId: string, value: { resultingRevision: number; resultingUpdatedAt: Date; resultingContentHash: string }) {
  return receiptSchema.parse({ id: lessonId, mutationId, revision: value.resultingRevision, updatedAt: value.resultingUpdatedAt.toISOString(), contentHash: value.resultingContentHash });
}
function metadata(value: { revision: number; createdAt: Date; source: string; operationId: string | null; restoredFromRevision: number | null; contentHash: string; documentSchemaVersion: number }) {
  return { revision: value.revision, createdAt: value.createdAt.toISOString(), source: value.source, operationId: value.operationId, restoredFromRevision: value.restoredFromRevision, contentHash: value.contentHash, documentSchemaVersion: value.documentSchemaVersion };
}
export class LessonService {
  constructor(private db: Database) {}
  async load(topicId: string) {
    const lesson = await this.db.lesson.findUnique({ where: { topicId } });
    if (!lesson) throw new HttpError(404, 'LESSON_NOT_GENERATED', 'No saved lesson. Create blank notes.');
    return lessonDTO(lesson);
  }
  async create(topicId: string, input: z.infer<typeof createLessonSchema>) {
    const requestHash = hashJSON({ kind: 'create', ...input });
    return transaction(this.db, async tx => {
      const topic = await tx.topic.findUnique({ where: { id: topicId } });
      if (!topic) throw new HttpError(404, 'NOT_FOUND', 'Topic not found.');
      await lockCourse(tx, topic.courseId);
      const existing = await tx.lesson.findUnique({ where: { topicId } });
      if (existing) {
        const replay = await tx.lessonMutation.findUnique({ where: { lessonId_mutationId: { lessonId: existing.id, mutationId: input.mutationId } } });
        if (!replay) throw new HttpError(409, 'LESSON_EXISTS', 'This topic already has saved notes.');
        if (replay.requestHash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'Mutation ID was already used with a different request.');
        return lessonDTO({ ...existing, revision: replay.resultingRevision, updatedAt: replay.resultingUpdatedAt, document: documentJSON(input.document) });
      }
      if (await tx.topic.count({ where: { parentId: topicId } })) throw new HttpError(409, 'NOT_A_LEAF', 'Only leaf topics can own notes.');
      const ids = await validateAssets(tx, topic.courseId, input.document);
      const lesson = await tx.lesson.create({ data: { topicId, document: documentJSON(input.document), contentHash: hashJSON(input.document), assets: { create: ids.map(assetId => ({ assetId })) } } });
      await tx.lessonMutation.create({ data: { lessonId: lesson.id, mutationId: input.mutationId, requestHash, resultingRevision: lesson.revision, resultingUpdatedAt: lesson.updatedAt, resultingContentHash: lesson.contentHash } });
      return lessonDTO(lesson);
    });
  }
  async save(id: string, input: z.infer<typeof saveLessonSchema>) {
    if (input.aiOperationId || input.imageOperationId) throw new HttpError(422, 'UNSUPPORTED_OPERATION', 'AI operations are not enabled.');
    return this.write(id, input.mutationId, input.baseRevision, hashJSON({ kind: 'save', ...input }), () => input.document);
  }
  async restore(id: string, input: z.infer<typeof restoreLessonSchema>) {
    return this.write(id, input.mutationId, input.baseRevision, hashJSON({ kind: 'restore', ...input }), async (tx, current) => {
      if (input.sourceRevision === current.revision) return tiptapDocumentSchema.parse(current.document);
      const version = await tx.documentVersion.findUnique({ where: { lessonId_revision: { lessonId: id, revision: input.sourceRevision } } });
      if (!version) throw new HttpError(404, 'NOT_FOUND', 'Version not found.');
      if (version.documentSchemaVersion !== 1) throw new HttpError(422, 'SCHEMA_UNSUPPORTED', 'Version requires a document migration.');
      return tiptapDocumentSchema.parse(version.document);
    }, input.sourceRevision);
  }
  async regenerate(id: string, raw: unknown) {
    const input = regenerationCommitSchema.parse(raw);
    return this.write(id, input.mutationId, input.baseRevision, hashJSON({ kind: 'regenerate', ...input }), async (tx, current) => {
      await tx.$queryRaw`SELECT id FROM ai_operations WHERE id = ${input.operationId}::uuid FOR UPDATE`;
      const operation = await tx.aiOperation.findUnique({ where: { id: input.operationId } });
      if (!operation || operation.kind !== 'regeneration' || operation.lessonId !== id || operation.topicId !== current.topicId) throw new HttpError(404, 'NOT_FOUND', 'Regeneration proposal not found for this lesson.');
      const result = operationResultSchema.safeParse(operation.result);
      if (operation.status !== 'ready' || !result.success || result.data.type !== 'lesson' || new Date(result.data.readyAt).getTime() < Date.now() - 7 * 86400000) throw new HttpError(409, 'OPERATION_NOT_READY', 'Regeneration is no longer available.');
      const topic = await tx.topic.findUniqueOrThrow({ where: { id: current.topicId }, include: { course: true } });
      if (operation.courseId !== topic.courseId || operation.baseRevision !== input.baseRevision || operation.baseTreeRevision !== topic.course.treeRevision) throw new HttpError(409, 'STALE_CONTEXT', 'The lesson or course context changed after generation.');
      if (hashJSON(result.data.document) !== result.data.contentHash) throw new HttpError(409, 'INVALID_OPERATION', 'Proposal integrity validation failed.');
      return result.data.document;
    }, undefined, input.operationId);
  }
  private async write(id: string, mutationId: string, baseRevision: number, requestHash: string, getDocument: (tx: Transaction, lesson: Lesson) => TiptapDocument | Promise<TiptapDocument>, restoredFromRevision?: number, regenerationId?: string) {
    return transaction(this.db, async tx => {
      const owner = await tx.lesson.findUnique({ where: { id }, select: { topic: { select: { courseId: true } } } });
      if (!owner) throw new HttpError(404, 'NOT_FOUND', 'Lesson not found.');
      await lockCourse(tx, owner.topic.courseId);
      await tx.$queryRaw`SELECT id FROM lessons WHERE id = ${id}::uuid FOR UPDATE`;
      const replay = await tx.lessonMutation.findUnique({ where: { lessonId_mutationId: { lessonId: id, mutationId } } });
      if (replay) {
        if (replay.requestHash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'Mutation ID was already used with a different request.');
        return receipt(id, mutationId, replay);
      }
      const current = await tx.lesson.findUniqueOrThrow({ where: { id } });
      if (current.revision !== baseRevision) throw new HttpError(409, 'REVISION_CONFLICT', 'Saved notes changed. Keep your local copy and review the server copy.', false, { currentRevision: current.revision });
      const document = tiptapDocumentSchema.parse(await getDocument(tx, current));
      const ids = await validateAssets(tx, owner.topic.courseId, document);
      const contentHash = hashJSON(document);
      let updated = current;
      if (contentHash !== current.contentHash || restoredFromRevision !== undefined || regenerationId !== undefined) {
        const references = await tx.lessonAsset.findMany({ where: { lessonId: id } });
        await tx.documentVersion.create({ data: { lessonId: id, revision: current.revision, document: documentJSON(tiptapDocumentSchema.parse(current.document)), documentSchemaVersion: current.documentSchemaVersion, contentHash: current.contentHash, source: current.source, operationId: current.operationId, restoredFromRevision: current.restoredFromRevision, createdAt: current.updatedAt, assets: { create: references.map(reference => ({ assetId: reference.assetId })) } } });
        const result = await tx.lesson.updateMany({ where: { id, revision: baseRevision }, data: { document: documentJSON(document), contentHash, revision: { increment: 1 }, source: regenerationId ? 'regenerate' : restoredFromRevision === undefined ? 'manual' : 'restore', operationId: regenerationId ?? null, restoredFromRevision: restoredFromRevision ?? null } });
        if (result.count !== 1) throw new HttpError(409, 'REVISION_CONFLICT', 'Notes changed.');
        await tx.lessonAsset.deleteMany({ where: { lessonId: id } });
        await tx.lessonAsset.createMany({ data: ids.map(assetId => ({ lessonId: id, assetId })) });
        updated = await tx.lesson.findUniqueOrThrow({ where: { id } });
      }
      const saved = await tx.lessonMutation.create({ data: { lessonId: id, mutationId, requestHash, resultingRevision: updated.revision, resultingUpdatedAt: updated.updatedAt, resultingContentHash: updated.contentHash } });
      if (regenerationId) await tx.aiOperation.update({ where: { id: regenerationId }, data: { status: 'applied', result: { type: 'applied_lesson', lessonId: id, revision: updated.revision } } });
      return receipt(id, mutationId, saved);
    });
  }
  async versions(id: string, cursor: number | undefined, limit: number) {
    const current = await this.db.lesson.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, 'NOT_FOUND', 'Lesson not found.');
    const versions = await this.db.documentVersion.findMany({ where: { lessonId: id, ...(cursor ? { revision: { lt: cursor } } : {}) }, orderBy: { revision: 'desc' }, take: limit + 1 });
    return versionsSchema.parse({ currentRevision: current.revision, versions: versions.slice(0, limit).map(metadata), page: { nextCursor: versions.length > limit ? String(versions[limit - 1]?.revision) : null } });
  }
  async version(id: string, revision: number) {
    const current = await this.db.lesson.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, 'NOT_FOUND', 'Lesson not found.');
    const value = current.revision === revision ? { ...current, createdAt: current.updatedAt } : await this.db.documentVersion.findUnique({ where: { lessonId_revision: { lessonId: id, revision } } });
    if (!value) throw new HttpError(404, 'NOT_FOUND', 'Version not found.');
    return versionSchema.parse({ ...metadata(value), document: value.document });
  }
}
