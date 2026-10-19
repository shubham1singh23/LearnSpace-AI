import { receiptSchema, type Lesson, type SaveLesson, type TiptapDocument } from '@learnspace/shared';
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
  constructor(readonly lesson: Lesson, private store: RecoveryStore, private transport: (body: SaveLesson) => Promise<Receipt>, private notify: (status: SaveStatus) => void, private sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
    this.revision = lesson.revision; this.document = structuredClone(lesson.document);
  }
  get dirty() { return this.invalid || this.sequence !== this.acknowledged || !!this.inFlight; }
  get snapshot() { return structuredClone(this.document); }
  get currentRevision() { return this.revision; }
  get localSequence() { return this.sequence; }
  private emit() { this.notify({ state: this.state, revision: this.revision, dirty: this.dirty, message: this.message, recoveryWarning: this.recoveryWarning }); }
  private persist() {
    const draft: RecoveryDraft = { lessonId: this.lesson.id, topicId: this.lesson.topicId, baseRevision: this.revision, sequence: this.sequence, acknowledged: this.acknowledged, document: structuredClone(this.document), updatedAt: new Date().toISOString(), ...(this.inFlight ? { inFlight: structuredClone(this.inFlight) } : {}) };
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
    this.revision = draft.baseRevision; this.inFlight = draft.inFlight;
    this.state = 'unsaved'; this.emit();
    // Never automatically send a recovered draft. The learner explicitly retries
    // its old request or chooses a fresh-revision overwrite after comparison.
  }
  async flush(): Promise<void> {
    clearTimeout(this.idle); clearTimeout(this.maximum); this.maximum = undefined;
    if (this.stopped) throw new Error('Autosave is closed.');
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
            this.state = 'conflict'; this.message = error.message; await this.persist(); this.emit(); throw error;
          }
          if (attempt === 2 || error instanceof ApiError && !error.retryable) {
            this.state = 'error'; this.message = error instanceof Error ? error.message : 'Save failed.'; await this.persist(); this.emit(); throw error;
          }
          await this.sleep(250 * 2 ** attempt);
        }
      }
      if (!saved) throw new Error('No save acknowledgement.');
      this.revision = saved.revision; this.acknowledged = captured.sequence; this.inFlight = undefined;
      this.state = this.dirty ? 'unsaved' : 'saved';
      await this.persist(); this.emit();
    }
  }
  async overwriteAt(revision: number) {
    if (this.running) await this.running.catch(() => undefined);
    this.revision = revision; this.inFlight = undefined; this.sequence++; this.state = 'unsaved';
    await this.persist(); await this.flush();
  }
  async discard() {
    if (this.running) throw new Error('Wait for the active save before discarding.');
    this.stop(); await this.persistence; await this.store.remove(this.lesson.id);
    this.invalid = false; this.inFlight = undefined; this.acknowledged = this.sequence; this.state = 'saved'; this.emit();
  }
  stop() { this.stopped = true; clearTimeout(this.idle); clearTimeout(this.maximum); }
  start() { this.stopped = false; }
}
