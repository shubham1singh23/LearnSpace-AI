import { canonicalJSON, insertionIsolationSchema, receiptSchema, saveLessonSchema, type InsertionIsolation, type Lesson, type SaveLesson, type TiptapDocument } from '@learnspace/shared';
import type { z } from 'zod';
import { ApiError } from '../api';
import type { RecoveryDraft, RecoveryStore } from './recovery';

type Receipt = z.infer<typeof receiptSchema>;
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';
export interface SaveStatus { state: SaveState; revision: number; dirty: boolean; message: string; recoveryWarning: string }
export class Autosave {
  private revision: number;
  private sequence = 0;
  private acknowledged = 0;
  private document: TiptapDocument;
  private inFlight?: { body: SaveLesson; sequence: number };
  private running?: Promise<void>;
  private idle?: ReturnType<typeof setTimeout>;
  private maximum?: ReturnType<typeof setTimeout>;
  private persistence: Promise<void> = Promise.resolve();
  private stopped = false;
  private state: SaveState = 'saved';
  private message = '';
  private recoveryWarning = '';
  private invalid = false;
  private journaling = false;
  private aiRejectionKnown = false;
  private isolation?: InsertionIsolation;
  constructor(readonly lesson: Lesson, private store: RecoveryStore, private transport: (body: SaveLesson) => Promise<Receipt>, private notify: (status: SaveStatus) => void, private sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
    this.revision = lesson.revision; this.document = structuredClone(lesson.document);
  }
  get dirty() { return this.journaling || this.invalid || this.sequence !== this.acknowledged || !!this.inFlight; }
  get snapshot() { return structuredClone(this.document); }
  get currentRevision() { return this.revision; }
  get localSequence() { return this.sequence; }
  get isolatedPending() { return this.journaling || !!this.inFlight && (!!this.inFlight.body.aiOperationId || !!this.isolation); }
  get pendingAiRequest() { return this.inFlight?.body.aiOperationId ? structuredClone(this.inFlight.body) : undefined; }
  get pendingInsertion() { return !!this.isolation; }
  get rejectedAiAcceptance() { return this.isolatedPending && this.aiRejectionKnown; }
  private emit() { this.notify({ state: this.state, revision: this.revision, dirty: this.dirty, message: this.message, recoveryWarning: this.recoveryWarning }); }
  private persist() {
    const draft: RecoveryDraft = { lessonId: this.lesson.id, topicId: this.lesson.topicId, baseRevision: this.revision, sequence: this.sequence, acknowledged: this.acknowledged, document: structuredClone(this.document), updatedAt: new Date().toISOString(), ...(this.isolation ? { isolation: structuredClone(this.isolation) } : {}), ...(this.inFlight ? { inFlight: structuredClone(this.inFlight) } : {}) };
    const dirty = this.dirty;
    this.persistence = this.persistence.then(async () => {
      try { if (dirty) await this.store.put(draft); else await this.store.remove(this.lesson.id); this.recoveryWarning = ''; }
      catch { this.recoveryWarning = 'Browser recovery storage is unavailable. Keep this tab open or download recovery JSON.'; }
      this.emit();
    });
    return this.persistence;
  }
  edit(document: TiptapDocument) {
    if (this.stopped) throw new Error('Autosave is closed.');
    if (this.isolatedPending) {
      // The acceptance transaction emits onUpdate, but must never enter the
      // ordinary coalescing path or acquire a fresh manual mutation ID.
      if (this.inFlight && canonicalJSON(document) === canonicalJSON(this.inFlight.body.document)) return;
      throw new Error('Resolve the isolated AI acceptance before editing.');
    }
    const wasInvalid = this.invalid; this.invalid = false;
    this.document = structuredClone(document); this.sequence++;
    if (wasInvalid && this.state === 'error') this.state = 'unsaved';
    if (this.state !== 'conflict' && this.state !== 'error') this.state = 'unsaved';
    void this.persist(); this.emit();
    if (this.state === 'conflict' || this.state === 'error') return;
    clearTimeout(this.idle); this.idle = setTimeout(() => void this.flush().catch(() => undefined), 750);
    this.maximum ??= setTimeout(() => void this.flush().catch(() => undefined), 5000);
  }
  invalidate() {
    this.sequence++;
    this.invalid = true; this.state = 'error'; this.message = 'Correct the invalid editor structure before saving.';
    clearTimeout(this.idle); clearTimeout(this.maximum); this.maximum = undefined; this.emit();
  }
  recover(draft: RecoveryDraft) {
    if (draft.lessonId !== this.lesson.id || draft.topicId !== this.lesson.topicId) throw new Error('Recovery draft owner mismatch.');
    this.document = structuredClone(draft.document); this.sequence = draft.sequence; this.acknowledged = draft.acknowledged;
    this.revision = draft.baseRevision; this.inFlight = draft.inFlight; this.isolation = draft.isolation;
    this.state = 'unsaved'; this.emit();
    // Never automatically send a recovered draft. The learner explicitly retries
    // its old request or chooses a fresh-revision overwrite after comparison.
  }
  async acceptEdit(operationId: string, document: TiptapDocument, apply: () => void) {
    return this.acceptIsolated(document, apply, { operationId });
  }
  async insertText(isolation: InsertionIsolation, document: TiptapDocument, apply: () => void) {
    return this.acceptIsolated(document, apply, { isolation: insertionIsolationSchema.parse(isolation) });
  }
  private async acceptIsolated(document: TiptapDocument, apply: () => void, identity: { operationId?: string; isolation?: InsertionIsolation }) {
    if (this.stopped || this.dirty || this.running || this.journaling) throw new Error('Flush saved notes before accepting an AI edit.');
    const body = saveLessonSchema.parse({ mutationId: crypto.randomUUID(), baseRevision: this.revision, documentSchemaVersion: 1, document: structuredClone(document), ...(identity.operationId ? { aiOperationId: identity.operationId } : {}) });
    const sequence = this.sequence + 1;
    this.journaling = true;
    this.emit();
    try {
      await this.persistence;
      // Unlike manual recovery writes, this journal is mandatory. No editor
      // transaction or network dispatch can precede its successful IDB commit.
      await this.store.put({ lessonId: this.lesson.id, topicId: this.lesson.topicId, baseRevision: this.revision, sequence, acknowledged: this.acknowledged, document: body.document, updatedAt: new Date().toISOString(), inFlight: { body, sequence }, ...(identity.isolation ? { isolation: identity.isolation } : {}) });
      this.inFlight = { body, sequence }; this.isolation = identity.isolation; this.document = structuredClone(body.document); this.sequence = sequence; this.state = 'unsaved';
      apply();
    } finally { this.journaling = false; this.emit(); }
    await this.flush();
  }
  async flush(): Promise<void> {
    clearTimeout(this.idle); clearTimeout(this.maximum); this.maximum = undefined;
    if (this.stopped) throw new Error('Autosave is closed.');
    if (this.journaling) throw new Error('The acceptance journal is being written.');
    if (this.state === 'conflict') throw new Error('Resolve the save conflict first.');
    if (!this.running) this.running = this.drain().finally(() => { this.running = undefined; });
    await this.running;
    // New typing can arrive while the final recovery-storage write completes.
    if (this.dirty) return this.flush();
  }
  private async drain() {
    while (this.dirty) {
      if (this.invalid) { this.state = 'error'; this.emit(); throw new Error('Correct the invalid editor structure before saving.'); }
      this.inFlight ??= { sequence: this.sequence, body: { mutationId: crypto.randomUUID(), baseRevision: this.revision, documentSchemaVersion: 1, document: structuredClone(this.document) } };
      await this.persist();
      const captured = this.inFlight;
      this.state = 'saving'; this.message = ''; this.emit();
      let saved: Receipt | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          saved = receiptSchema.parse(await this.transport(structuredClone(captured.body)));
          if (saved.id !== this.lesson.id || saved.mutationId !== captured.body.mutationId) throw new Error('Save acknowledgement mismatch.');
          break;
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            if (captured.body.aiOperationId || this.isolation) this.aiRejectionKnown = true;
            this.state = 'conflict'; this.message = error.message; await this.persist(); this.emit(); throw error;
          }
          if (attempt === 2 || error instanceof ApiError && !error.retryable) {
            if ((captured.body.aiOperationId || this.isolation) && error instanceof ApiError && !error.retryable && error.status < 500) this.aiRejectionKnown = true;
            this.state = 'error'; this.message = error instanceof Error ? error.message : 'Save failed.'; await this.persist(); this.emit(); throw error;
          }
          await this.sleep(250 * 2 ** attempt);
        }
      }
      if (!saved) throw new Error('No save acknowledgement.');
      this.revision = saved.revision; this.acknowledged = captured.sequence; this.inFlight = undefined;
      this.isolation = undefined;
      this.aiRejectionKnown = false;
      this.state = this.dirty ? 'unsaved' : 'saved';
      await this.persist(); this.emit();
    }
  }
  async overwriteAt(revision: number) {
    if (this.isolatedPending) throw new Error('An AI acceptance cannot become a manual overwrite. Replay its original request.');
    if (this.running) await this.running.catch(() => undefined);
    if (this.isolatedPending) throw new Error('An AI acceptance cannot become a manual overwrite.');
    this.revision = revision; this.inFlight = undefined; this.sequence++; this.state = 'unsaved';
    await this.persist(); await this.flush();
  }
  async discard() {
    if (this.isolatedPending) throw new Error('Resolve the AI acceptance outcome before discarding its journal.');
    if (this.running) throw new Error('Wait for the active save before discarding.');
    this.stop(); await this.persistence; await this.store.remove(this.lesson.id);
    this.invalid = false; this.inFlight = undefined; this.acknowledged = this.sequence; this.state = 'saved'; this.emit();
  }
  async discardRejectedEdit() {
    if (!this.rejectedAiAcceptance || this.running) throw new Error('Acceptance outcome is still unknown.');
    this.inFlight = undefined; this.aiRejectionKnown = false;
    this.isolation = undefined;
    await this.discard();
  }
  stop() { this.stopped = true; clearTimeout(this.idle); clearTimeout(this.maximum); }
  start() { this.stopped = false; }
}
