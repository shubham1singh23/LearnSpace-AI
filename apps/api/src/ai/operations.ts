import { randomUUID } from 'node:crypto';
import { chatModelOutputSchema, contextManifestSchema, modelSnapshotSchema, operationDTOSchema, operationMetadataSchema, operationResultSchema, type ContextManifest, type ModelSnapshot, type OperationKind, type SelectionTarget, type TiptapDocument } from '@learnspace/shared';
import type { z } from 'zod';
import type { TextAdapter } from '@learnspace/ai';
import type { AiOperation, Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { hashJSON } from '../workspace/lesson-service.js';
import { lockCourse, transaction, type Transaction } from '../workspace/transactions.js';
import type { ConfigurationService } from './configuration.js';

export function json(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(item => item === null ? null : json(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, item === null ? null : json(item)]));
  throw new Error('Non-JSON operation data');
}
export function operationDTO(row: AiOperation) {
  return operationDTOSchema.parse({ id: row.id, courseId: row.courseId, topicId: row.topicId, lessonId: row.lessonId, kind: row.kind, status: row.status, baseRevision: row.baseRevision, baseTreeRevision: row.baseTreeRevision, model: row.modelSnapshot, context: row.contextManifest, result: row.result, errorCode: row.errorCode, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
}
export type OperationResult = z.infer<typeof operationResultSchema>;
export interface CapturedOperation {
  topicId?: string; lessonId?: string; baseRevision?: number; baseTreeRevision: number;
  context: ContextManifest; input: string;
  target?: SelectionTarget; document?: TiptapDocument;
}
export interface StartOperation {
  courseId: string; kind: OperationKind; ownerId: string; idempotencyKey: string; request: unknown; retryOfOperationId?: string;
  capture: (tx: Transaction, model: ModelSnapshot) => Promise<CapturedOperation>;
  promptVersion?: 'selection-edit-v1' | 'chat-v1';
  onReserved?: (tx: Transaction, row: AiOperation, capture: CapturedOperation) => Promise<void>;
}
export type OperationWork = (adapter: TextAdapter, capture: CapturedOperation, signal: AbortSignal, operation: AiOperation) => Promise<OperationResult | { type: 'chat_candidate'; text: string }>;
interface Measurement { operationId: string; provider: string; modelId: string; attempt: number; durationMs: number; outcome: string }

export class OperationService {
  private readonly active = new Map<string, { abort: AbortController; owner: string }>();
  constructor(readonly configuration: ConfigurationService) {}
  get db() { return this.configuration.db; }
  async reconcile() {
    const expired = await this.db.aiOperation.findMany({ where: { kind: 'chat', status: { in: ['pending', 'running'] }, OR: [{ leaseUntil: { lte: new Date() } }, { leaseUntil: null }] }, take: 100, orderBy: { id: 'asc' } });
    for (const row of expired) await this.terminalChat(row, 'interrupted', 'EXECUTION_INTERRUPTED', [], true);
    // Expired executions never resume automatically: their in-memory inputs and credentials are gone.
    await this.db.aiOperation.updateMany({ where: { kind: { in: ['syllabus', 'initial_lesson', 'regeneration', 'edit'] }, status: { in: ['pending', 'running'] }, OR: [{ leaseUntil: { lte: new Date() } }, { leaseUntil: null }] }, data: { status: 'interrupted', errorCode: 'EXECUTION_INTERRUPTED', ownerToken: null, leaseUntil: null } });
    const ready = await this.db.aiOperation.findMany({ where: { kind: { in: ['syllabus', 'initial_lesson', 'regeneration', 'edit'] }, status: 'ready', updatedAt: { lte: new Date(Date.now() - 7 * 86400000) } }, select: { id: true } });
    if (ready.length) await this.db.aiOperation.updateMany({ where: { id: { in: ready.map(row => row.id) }, status: 'ready' }, data: { status: 'expired', errorCode: 'PROPOSAL_EXPIRED' } });
  }
  async get(id: string) { await this.reconcile(); const row = await this.db.aiOperation.findUnique({ where: { id } }); if (!row || !['syllabus', 'initial_lesson', 'regeneration', 'edit', 'chat'].includes(row.kind)) throw new HttpError(404, 'NOT_FOUND', 'Operation not found.'); return operationDTO(row); }
  async list(courseId: string, cursor?: string, limit = 50) {
    await this.reconcile();
    if (!await this.db.course.findUnique({ where: { id: courseId }, select: { id: true } })) throw new HttpError(404, 'NOT_FOUND', 'Course not found.');
    if (cursor && !await this.db.aiOperation.findFirst({ where: { id: cursor, courseId } })) throw new HttpError(422, 'INVALID_CURSOR', 'Operation cursor does not belong to this course.');
    const rows = await this.db.aiOperation.findMany({ where: { courseId, kind: { in: ['syllabus', 'initial_lesson', 'regeneration', 'edit', 'chat'] } }, orderBy: { id: 'asc' }, take: Math.min(100, limit) + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    return { operations: rows.slice(0, limit).map(row => operationMetadataSchema.parse(Object.fromEntries(Object.entries(operationDTO(row)).filter(([key]) => key !== 'result')))), page: { nextCursor: rows.length > limit ? rows.slice(0, limit).at(-1)!.id : null } };
  }
  async start(input: StartOperation, work: OperationWork) {
    await this.reconcile();
    const scopeKey = `${input.kind}:${input.ownerId}`; const requestHash = hashJSON(input.request);
    const replay = await this.db.aiOperation.findUnique({ where: { scopeKey_idempotencyKey: { scopeKey, idempotencyKey: input.idempotencyKey } } });
    if (replay) { if (replay.requestHash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'The request key already belongs to different input.'); return operationDTO(replay); }
    if (input.kind === 'initial_lesson' || input.kind === 'chat') {
      const running = await this.db.aiOperation.findFirst({ where: { scopeKey, status: { in: ['pending', 'running'] } } });
      if (running) { if (running.requestHash !== requestHash) throw new HttpError(409, input.kind === 'chat' ? 'CHAT_TURN_ACTIVE' : 'GENERATION_ACTIVE', 'Another request is already active for this lesson.'); return operationDTO(running); }
    }
    const release = this.configuration.reserve(); let execution: { row: AiOperation; capture: CapturedOperation; adapter: TextAdapter } | undefined;
    try {
      const result = await transaction(this.db, async tx => {
        // Serialize global admission before all course locks. This is a capacity lock, not a queue.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(711031)::text`;
        const duplicate = await tx.aiOperation.findUnique({ where: { scopeKey_idempotencyKey: { scopeKey, idempotencyKey: input.idempotencyKey } } });
        if (duplicate) { if (duplicate.requestHash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_MISMATCH', 'The request key already belongs to different input.'); return duplicate; }
        await lockCourse(tx, input.courseId);
        if (input.retryOfOperationId) {
          const prior = await tx.aiOperation.findUnique({ where: { id: input.retryOfOperationId } });
          if (!prior || prior.scopeKey !== scopeKey || !['failed', 'cancelled', 'interrupted', 'expired', 'rejected'].includes(prior.status)) throw new HttpError(409, 'INVALID_RETRY', 'Retry requires a terminal operation in the same scope.');
        }
        if (input.kind === 'initial_lesson' || input.kind === 'chat') {
          const active = await tx.aiOperation.findFirst({ where: { scopeKey, status: { in: ['pending', 'running'] } } });
          if (active) { if (active.requestHash !== requestHash) throw new HttpError(409, input.kind === 'chat' ? 'CHAT_TURN_ACTIVE' : 'GENERATION_ACTIVE', 'Another request is already active for this lesson.'); return active; }
        }
        if (await tx.aiOperation.count({ where: { status: { in: ['pending', 'running'] }, leaseUntil: { gt: new Date() } } }) >= 2) throw new HttpError(429, 'MODEL_CAPACITY', 'Two operations are already active. Retry later.', true);
        const { snapshot, adapter } = await this.configuration.resolve(); modelSnapshotSchema.parse(snapshot);
        const capture = await input.capture(tx, snapshot); contextManifestSchema.parse(capture.context);
        const row = await tx.aiOperation.create({ data: { courseId: input.courseId, topicId: capture.topicId, lessonId: capture.lessonId, kind: input.kind, status: 'running', scopeKey, idempotencyKey: input.idempotencyKey, requestHash, baseRevision: capture.baseRevision, baseTreeRevision: capture.baseTreeRevision, retryOfOperationId: input.retryOfOperationId, target: json(capture.target ?? input.request), contextManifest: json(capture.context), modelSnapshot: json(snapshot), promptVersion: input.promptVersion ?? 'educational-v1', ownerToken: randomUUID(), leaseUntil: new Date(Date.now() + 30000) } });
        await input.onReserved?.(tx, row, capture);
        execution = { row, capture, adapter }; return row;
      });
      if (execution) { const running = execution; void this.execute(running.row, running.capture, running.adapter, work, release); }
      else release();
      return operationDTO(result);
    } catch (error) { release(); throw error; }
  }
  private async execute(row: AiOperation, capture: CapturedOperation, adapter: TextAdapter, work: OperationWork, release: () => void) {
    const abort = new AbortController(); const owner = row.ownerToken!; this.active.set(row.id, { abort, owner });
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]);
    const heartbeat = setInterval(() => {
      if (signal.aborted) { clearInterval(heartbeat); return; }
      void this.db.aiOperation.updateMany({ where: { id: row.id, ownerToken: owner, status: 'running', leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + 30000) } }).then(result => { if (!result.count) abort.abort(); }).catch(() => abort.abort());
    }, 5000); heartbeat.unref();
    let attempt = 0; const measurements: Measurement[] = [];
    const measured: TextAdapter = { generate: async (system, input, schema, callSignal) => {
      const number = ++attempt; const started = Date.now(); let outcome = 'failed';
      try { const result = await adapter.generate(system, input, schema, callSignal); outcome = 'success'; return result; }
      finally {
        if (callSignal.aborted) outcome = 'cancelled';
        const model: ModelSnapshot = modelSnapshotSchema.parse(row.modelSnapshot);
        const measurement = { operationId: row.id, provider: model.provider, modelId: model.modelId, attempt: number, durationMs: Date.now() - started, outcome };
        if (row.kind === 'chat') measurements.push(measurement);
        else await this.db.modelUsage.create({ data: measurement }).catch(() => {});
      }
    } };
    try {
      const candidate = await work(measured, capture, signal, row);
      if (row.kind === 'chat') {
        if (candidate.type !== 'chat_candidate') throw new Error('Invalid chat candidate');
        const { text } = chatModelOutputSchema.parse({ text: candidate.text });
        await transaction(this.db, async tx => {
          await lockCourse(tx, row.courseId!);
          await tx.$queryRaw`SELECT id FROM lessons WHERE id = ${row.lessonId}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM ai_operations WHERE id = ${row.id}::uuid FOR UPDATE`;
          const current = await tx.aiOperation.findUniqueOrThrow({ where: { id: row.id } });
          if (signal.aborted || current.status !== 'running' || current.ownerToken !== owner || !current.leaseUntil || current.leaseUntil <= new Date() || Date.now() - row.createdAt.getTime() >= 120000) throw new HttpError(409, 'EXECUTION_INTERRUPTED', 'Chat execution no longer owns this turn.');
          const user = await tx.chatMessage.findFirst({ where: { operationId: row.id, role: 'user', status: 'pending', lessonId: row.lessonId! } });
          if (!user) throw new HttpError(409, 'EXECUTION_INTERRUPTED', 'Turn ownership changed.');
          const assistant = await tx.chatMessage.create({ data: { lessonId: user.lessonId, role: 'assistant', content: text, sequence: user.sequence + 1, turnId: user.turnId, operationId: row.id, status: 'completed', contextRevision: user.contextRevision } });
          await tx.chatMessage.update({ where: { id: user.id }, data: { status: 'completed' } });
          if (measurements.length) await tx.modelUsage.createMany({ data: measurements });
          const result = operationResultSchema.parse({ type: 'applied_chat', lessonId: user.lessonId, turnId: user.turnId, messageId: assistant.id, contextRevision: user.contextRevision });
          await tx.aiOperation.update({ where: { id: row.id }, data: { status: 'applied', result: json(result), ownerToken: null, leaseUntil: null } });
        });
        return;
      }
      const result = operationResultSchema.parse(candidate);
      if (signal.aborted) return;
      if (row.kind === 'edit') {
        await transaction(this.db, async tx => {
          const course = await lockCourse(tx, row.courseId!);
          await tx.$queryRaw`SELECT id FROM lessons WHERE id = ${row.lessonId}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM ai_operations WHERE id = ${row.id}::uuid FOR UPDATE`;
          const lesson = await tx.lesson.findUnique({ where: { id: row.lessonId! } });
          if (!lesson || lesson.revision !== row.baseRevision || course.treeRevision !== row.baseTreeRevision) throw new HttpError(409, 'STALE_CONTEXT', 'Saved context changed during generation.');
          if (signal.aborted) return;
          await tx.aiOperation.updateMany({ where: { id: row.id, ownerToken: owner, status: 'running', leaseUntil: { gt: new Date() } }, data: { result: json(result), status: 'ready', ownerToken: null, leaseUntil: null } });
        });
        return;
      }
      await this.db.aiOperation.updateMany({ where: { id: row.id, ownerToken: owner, status: 'running', leaseUntil: { gt: new Date() } }, data: { result: json(result), status: 'ready', ownerToken: null, leaseUntil: null } });
    } catch (error) {
      if (row.kind === 'chat') { await this.terminalChat(row, signal.aborted ? 'interrupted' : 'failed', signal.aborted ? 'EXECUTION_INTERRUPTED' : error instanceof HttpError ? error.code : 'GENERATION_FAILED', measurements).catch(() => {}); return; }
      await this.db.aiOperation.updateMany({ where: { id: row.id, ownerToken: owner, status: 'running' }, data: { status: signal.aborted ? 'interrupted' : 'failed', errorCode: signal.aborted ? 'EXECUTION_INTERRUPTED' : error instanceof HttpError ? error.code : 'GENERATION_FAILED', ownerToken: null, leaseUntil: null } }).catch(() => {});
    } finally {
      clearInterval(heartbeat); this.active.delete(row.id); release();
    }
  }
  async cancel(id: string, reject = false) {
    const row = await this.db.aiOperation.findUnique({ where: { id } }); if (!row?.courseId || !['syllabus', 'initial_lesson', 'regeneration', 'edit', 'chat'].includes(row.kind)) throw new HttpError(404, 'NOT_FOUND', 'Operation not found.');
    if (row.kind === 'chat') { await this.terminalChat(row, 'cancelled', null); this.active.get(id)?.abort.abort(); return this.get(id); }
    const updated = await transaction(this.db, async tx => {
      await lockCourse(tx, row.courseId!);
      if (row.lessonId) await tx.$queryRaw`SELECT id FROM lessons WHERE id = ${row.lessonId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM ai_operations WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.aiOperation.findUniqueOrThrow({ where: { id } });
      if (['pending', 'running', 'ready'].includes(current.status)) return tx.aiOperation.update({ where: { id }, data: { status: reject ? 'rejected' : 'cancelled', ownerToken: null, leaseUntil: null } });
      return current;
    });
    this.active.get(id)?.abort.abort(); return operationDTO(updated);
  }
  stop() { for (const { abort } of this.active.values()) abort.abort(); }
  private async terminalChat(row: AiOperation, status: 'failed' | 'interrupted' | 'cancelled', errorCode: string | null, measurements: Measurement[] = [], expiredOnly = false) {
    return transaction(this.db, async tx => {
      await lockCourse(tx, row.courseId!);
      await tx.$queryRaw`SELECT id FROM lessons WHERE id = ${row.lessonId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM ai_operations WHERE id = ${row.id}::uuid FOR UPDATE`;
      const current = await tx.aiOperation.findUnique({ where: { id: row.id } });
      if (!current || !['pending', 'running'].includes(current.status) || current.ownerToken !== row.ownerToken || (expiredOnly && current.leaseUntil && current.leaseUntil > new Date())) return;
      await tx.chatMessage.updateMany({ where: { operationId: row.id, role: 'user', status: 'pending' }, data: { status } });
      if (measurements.length) await tx.modelUsage.createMany({ data: measurements });
      await tx.aiOperation.update({ where: { id: row.id }, data: { status, errorCode, ownerToken: null, leaseUntil: null } });
    });
  }
}
