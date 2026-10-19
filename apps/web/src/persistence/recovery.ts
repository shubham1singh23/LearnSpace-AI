import { z } from 'zod';
import { canonicalJSON, chatStartJournalSchema, idSchema, insertionIsolationSchema, revisionSchema, saveLessonSchema, tiptapDocumentSchema, type ChatStartJournal } from '@learnspace/shared';

export const recoverySchema = z.object({
  lessonId: idSchema, topicId: idSchema, baseRevision: revisionSchema,
  sequence: z.number().int().nonnegative(), acknowledged: z.number().int().nonnegative(),
  document: tiptapDocumentSchema, updatedAt: z.string(),
  isolation: insertionIsolationSchema.optional(),
  inFlight: z.object({ body: saveLessonSchema, sequence: z.number().int().positive() }).strict().optional()
}).strict().superRefine((draft, context) => {
  if (draft.acknowledged > draft.sequence || draft.inFlight && (draft.inFlight.sequence <= draft.acknowledged || draft.inFlight.sequence > draft.sequence || draft.inFlight.body.baseRevision !== draft.baseRevision)) context.addIssue({ code: 'custom', message: 'Inconsistent recovery sequence or revision.' });
  if (draft.isolation && (!draft.inFlight || draft.inFlight.body.aiOperationId || draft.inFlight.body.imageOperationId)) context.addIssue({ code: 'custom', message: 'Local insertion requires its isolated manual request.' });
  if ((draft.inFlight?.body.aiOperationId || draft.isolation) && draft.inFlight && (draft.sequence !== draft.inFlight.sequence || canonicalJSON(draft.document) !== canonicalJSON(draft.inFlight.body.document))) context.addIssue({ code: 'custom', message: 'Acceptance recovery must preserve its exact immutable document.' });
});
export type RecoveryDraft = z.infer<typeof recoverySchema>;
export interface RecoveryStore { get(id: string): Promise<RecoveryDraft | undefined>; put(draft: RecoveryDraft): Promise<void>; remove(id: string): Promise<void> }
export class IndexedDBRecovery implements RecoveryStore {
  constructor(private scope = 'default') {}
  private key(id: string) { return `${id}:${this.scope}`; }
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('learnspace-recovery-v1', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('drafts', { keyPath: 'lessonId' }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Recovery storage unavailable.'));
      request.onblocked = () => reject(new Error('Close older LearnSpace tabs to enable recovery storage.'));
    });
  }
  private async run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction('drafts', mode); const request = work(tx.objectStore('drafts'));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(new Error('Recovery storage write/read failed.'));
      });
    } finally { db.close(); }
  }
  async get(id: string) {
    const value: unknown = await this.run('readonly', store => store.get(this.key(id)));
    if (value === undefined) return undefined;
    return recoverySchema.parse(z.object({ lessonId: z.string(), draft: recoverySchema }).strict().parse(value).draft);
  }
  async put(draft: RecoveryDraft) { await this.run('readwrite', store => store.put({ lessonId: this.key(draft.lessonId), draft: recoverySchema.parse(draft) })); }
  async remove(id: string) { await this.run('readwrite', store => store.delete(this.key(id))); }
  async getChatStart(id: string) {
    const value: unknown = await this.run('readonly', store => store.get(this.key(`chat-start:${id}`)));
    return value === undefined ? undefined : z.object({ lessonId: z.string(), journal: chatStartJournalSchema }).strict().parse(value).journal;
  }
  async putChatStart(journal: ChatStartJournal) { await this.run('readwrite', store => store.put({ lessonId: this.key(`chat-start:${journal.lessonId}`), journal: chatStartJournalSchema.parse(journal) })); }
  async removeChatStart(id: string) { await this.run('readwrite', store => store.delete(this.key(`chat-start:${id}`))); }
}
