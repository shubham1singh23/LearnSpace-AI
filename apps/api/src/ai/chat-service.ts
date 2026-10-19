import { chatPageQuerySchema, chatPageSchema, chatStartSchema, contextManifestSchema } from '@learnspace/shared';
import { generateChat } from '@learnspace/ai';
import { HttpError } from '../errors.js';
import { hashJSON } from '../workspace/lesson-service.js';
import { captureChatContext } from './chat-context.js';
import { OperationService } from './operations.js';

export class ChatService {
  constructor(readonly operations: OperationService) {}
  async start(lessonId: string, key: string, raw: unknown) {
    const request = chatStartSchema.parse(raw); const db = this.operations.db;
    const lesson = await db.lesson.findUnique({ where: { id: lessonId }, select: { topic: { select: { courseId: true } } } });
    if (!lesson) throw new HttpError(404, 'NOT_FOUND', 'Lesson not found.');
    return this.operations.start({ courseId: lesson.topic.courseId, kind: 'chat', ownerId: lessonId, idempotencyKey: key, request, retryOfOperationId: request.retryOfOperationId, promptVersion: 'chat-v1', capture: async (tx, model) => {
      await tx.$queryRaw`SELECT id FROM lessons WHERE id = ${lessonId}::uuid FOR UPDATE`;
      const saved = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId } });
      if (saved.revision !== request.baseRevision) throw new HttpError(409, 'REVISION_CONFLICT', 'Save and capture current notes before asking.');
      const user = await tx.chatMessage.findUnique({ where: { turnId_role: { turnId: request.clientTurnId, role: 'user' } } });
      if (user && user.lessonId !== lessonId) throw new HttpError(409, 'INVALID_RETRY', 'Turn identity is unavailable.');
      const capture = await captureChatContext(tx, lessonId, request.message, request.selectedBlockIds ?? [], model);
      const contextHash = capture.context.chat!.contextHash;
      if (user) {
        if (user.status === 'completed') throw new HttpError(409, 'TURN_ALREADY_COMPLETED', 'This turn is already complete.');
        const prior = request.retryOfOperationId ? await tx.aiOperation.findUnique({ where: { id: request.retryOfOperationId } }) : null;
        const latest = await tx.chatMessage.findFirst({ where: { lessonId, role: 'user' }, orderBy: { sequence: 'desc' } });
        if (!prior || user.operationId !== prior.id || latest?.id !== user.id || !['failed', 'interrupted', 'cancelled'].includes(prior.status) || user.content !== request.message || user.contextRevision !== request.baseRevision) throw new HttpError(409, 'INVALID_RETRY', 'Retry only the latest unsuccessful unchanged turn.');
        const old = chatStartSchema.parse(prior.target);
        if (hashJSON(old.selectedBlockIds ?? []) !== hashJSON(request.selectedBlockIds ?? []) || contextManifestSchema.parse(prior.contextManifest).chat?.contextHash !== contextHash) throw new HttpError(409, 'TURN_CONTEXT_CHANGED', 'Context changed; send a new question.');
      } else if (request.retryOfOperationId) throw new HttpError(409, 'INVALID_RETRY', 'Retry must retain its original turn.');
      return capture;
    }, onReserved: async (tx, row) => {
      const existing = await tx.chatMessage.findUnique({ where: { turnId_role: { turnId: request.clientTurnId, role: 'user' } } });
      if (existing) { await tx.chatMessage.update({ where: { id: existing.id }, data: { status: 'pending', operationId: row.id } }); return; }
      const last = await tx.chatMessage.findFirst({ where: { lessonId }, orderBy: { sequence: 'desc' } });
      const sequence = last ? Math.floor(last.sequence / 2) * 2 + 2 : 0;
      await tx.chatMessage.create({ data: { lessonId, role: 'user', content: request.message, sequence, turnId: request.clientTurnId, operationId: row.id, status: 'pending', contextRevision: request.baseRevision } });
    } }, async (adapter, capture, signal) => ({ type: 'chat_candidate', ...(await generateChat(adapter, capture.input, signal)) }));
  }
  async messages(lessonId: string, raw: unknown) {
    const query = chatPageQuerySchema.parse(raw); const db = this.operations.db; await this.operations.reconcile();
    if (!await db.lesson.findUnique({ where: { id: lessonId }, select: { id: true } })) throw new HttpError(404, 'NOT_FOUND', 'Lesson not found.');
    const cursorId = query.before ?? query.after;
    const cursor = cursorId ? await db.chatMessage.findFirst({ where: { id: cursorId, lessonId } }) : null;
    if (cursorId && !cursor) throw new HttpError(422, 'INVALID_CURSOR', 'Cursor does not belong to this lesson.');
    const ascending = !!query.after;
    const rows = await db.chatMessage.findMany({ where: { lessonId, ...(cursor ? { sequence: ascending ? { gt: cursor.sequence } : { lt: cursor.sequence } } : {}) }, orderBy: { sequence: ascending ? 'asc' : 'desc' }, take: query.limit + 1 });
    const messages = rows.slice(0, query.limit); if (!ascending) messages.reverse();
    const active = await db.aiOperation.findFirst({ where: { lessonId, kind: 'chat', status: { in: ['pending', 'running'] } }, select: { id: true } });
    return chatPageSchema.parse({ messages: messages.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })), page: { olderCursor: !ascending && rows.length > query.limit ? messages[0]!.id : null, newerCursor: ascending && rows.length > query.limit ? messages.at(-1)!.id : null }, activeOperationId: active?.id ?? null });
  }
}
