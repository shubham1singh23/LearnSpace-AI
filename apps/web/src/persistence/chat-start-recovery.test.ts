import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { IndexedDBRecovery } from './recovery';

it('journals immutable Send identity independently of notes, lesson and tab scope', async () => {
  const store = new IndexedDBRecovery('chat-test'); const lessonId = crypto.randomUUID();
  const journal = { version: 1 as const, lessonId, idempotencyKey: crypto.randomUUID(), body: { baseRevision: 2, message: 'Question', clientTurnId: crypto.randomUUID() }, createdAt: new Date().toISOString() };
  await store.putChatStart(journal);
  expect(await store.getChatStart(lessonId)).toEqual(journal); expect(await store.get(lessonId)).toBeUndefined();
  expect(await new IndexedDBRecovery('other-tab').getChatStart(lessonId)).toBeUndefined();
  expect(await store.getChatStart(crypto.randomUUID())).toBeUndefined();
  journal.body.message = 'Changed local variable'; expect((await store.getChatStart(lessonId))?.body.message).toBe('Question');
  await store.remove(lessonId); expect(await store.getChatStart(lessonId)).toBeDefined();
  await store.removeChatStart(lessonId); expect(await store.getChatStart(lessonId)).toBeUndefined();
});
