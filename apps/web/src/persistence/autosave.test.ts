import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Lesson, type SaveLesson, type TiptapDocument } from '@learnspace/shared';
import { Autosave } from './autosave';
import { IndexedDBRecovery } from './recovery';
import { ApiError } from '../api';

function document(text: string): TiptapDocument { return { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'a8000000-0000-4000-8000-000000000001' }, content: [{ type: 'text', text }] }] }; }
const lesson = (): Lesson => ({ id: crypto.randomUUID(), topicId: crypto.randomUUID(), revision: 1, documentSchemaVersion: 1, document: document('Original'), updatedAt: new Date().toISOString() });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
const receipt = (id: string, body: SaveLesson, revision: number) => ({ id, mutationId: body.mutationId, revision, updatedAt: new Date().toISOString(), contentHash: 'a'.repeat(64) });
const queues: Autosave[] = [];
afterEach(() => { queues.forEach(queue => queue.stop()); queues.length = 0; vi.useRealTimers(); });
describe('Phase 6 autosave and IndexedDB gate', () => {
  it('keeps manual chat insertions isolated, journaled and immutable after lost acknowledgements and refresh', async () => {
    const value = lesson(); const store = new IndexedDBRecovery(); const bodies: SaveLesson[] = [];
    const queue = new Autosave(value, store, async body => { bodies.push(body); throw new TypeError('Lost insertion acknowledgement'); }, () => undefined, async () => undefined); queues.push(queue);
    const candidate = document('Inserted answer'); const isolation = { kind: 'chat_insert' as const, sourceId: crypto.randomUUID(), sourceHash: 'a'.repeat(64) };
    await expect(queue.insertText(isolation, candidate, () => { queue.edit(candidate); expect(queue.isolatedPending).toBe(true); })).rejects.toThrow('Lost insertion');
    expect(bodies).toHaveLength(3); expect(bodies[0]?.aiOperationId).toBeUndefined(); expect(bodies[0]?.imageOperationId).toBeUndefined();
    const draft = await store.get(value.id); expect(draft?.isolation).toEqual(isolation); expect(draft?.inFlight?.body).toEqual(bodies[0]);
    await expect(queue.overwriteAt(3)).rejects.toThrow('manual overwrite'); expect(() => queue.edit(document('Typing'))).toThrow('isolated');
    const replayed: SaveLesson[] = []; const recovered = new Autosave({ ...value, revision: 2 }, store, async body => { replayed.push(body); return receipt(value.id, body, 2); }, () => undefined); queues.push(recovered); recovered.recover(draft!);
    expect(recovered.isolatedPending).toBe(true); await recovered.flush(); expect(replayed).toEqual([bodies[0]]); expect(recovered.isolatedPending).toBe(false);
  });
  it('journals isolated acceptance before dispatch, excludes typing and replays the exact AI request after refresh', async () => {
    const value = lesson(); const store = new IndexedDBRecovery(); const bodies: SaveLesson[] = []; const order: string[] = [];
    const queue = new Autosave(value, store, async body => { order.push('http'); bodies.push(body); throw new TypeError('Lost AI acknowledgement'); }, () => undefined, async () => undefined); queues.push(queue);
    const candidate = document('Accepted fragment'); const operationId = crypto.randomUUID();
    await expect(queue.acceptEdit(operationId, candidate, () => { order.push('dispatch'); queue.edit(candidate); expect(() => queue.edit(document('New typing'))).toThrow('isolated'); })).rejects.toThrow('Lost AI');
    expect(order[0]).toBe('dispatch'); expect(bodies).toHaveLength(3); expect(bodies.every(body => body.aiOperationId === operationId && body.mutationId === bodies[0]!.mutationId)).toBe(true);
    await expect(queue.overwriteAt(2)).rejects.toThrow('manual overwrite'); await expect(queue.discard()).rejects.toThrow('outcome');
    const draft = await store.get(value.id); expect(draft?.inFlight?.body).toEqual(bodies[0]);
    const replayed: SaveLesson[] = []; const next = new Autosave({ ...value, revision: 2 }, store, async body => { replayed.push(body); return receipt(value.id, body, 2); }, () => undefined); queues.push(next); next.recover(draft!);
    expect(next.isolatedPending).toBe(true); expect(() => next.edit(document('Manual downgrade'))).toThrow('isolated'); await next.flush(); expect(replayed).toEqual([bodies[0]]); expect(next.isolatedPending).toBe(false); expect(next.currentRevision).toBe(2);
  });
  it('does not dispatch or send acceptance when the mandatory recovery journal fails', async () => {
    const value = lesson(); let dispatched = false; let calls = 0;
    const queue = new Autosave(value, { get: async () => undefined, put: async () => { throw new Error('Quota'); }, remove: async () => undefined }, async body => { calls++; return receipt(value.id, body, 2); }, () => undefined); queues.push(queue);
    await expect(queue.acceptEdit(crypto.randomUUID(), document('Proposal'), () => { dispatched = true; })).rejects.toThrow('Quota');
    expect(dispatched).toBe(false); expect(calls).toBe(0); expect(queue.snapshot).toEqual(value.document); expect(queue.dirty).toBe(false);
  });
  it('coalesces pending edits, serializes saves, and drains typing that arrives during an in-flight save', async () => {
    const value = lesson(); const first = deferred<ReturnType<typeof receipt>>(); const started = deferred<void>();
    const bodies: SaveLesson[] = []; let active = 0; let maximum = 0;
    const queue = new Autosave(value, new IndexedDBRecovery(), async body => {
      bodies.push(body); active++; maximum = Math.max(maximum, active);
      if (bodies.length === 1) { started.resolve(); const result = await first.promise; active--; return result; }
      active--; return receipt(value.id, body, 3);
    }, () => undefined);
    queues.push(queue); queue.edit(document('First')); const flush = queue.flush(); await started.promise;
    queue.edit(document('Second')); queue.edit(document('Newest'));
    first.resolve(receipt(value.id, bodies[0]!, 2)); await flush;
    expect(maximum).toBe(1); expect(bodies).toHaveLength(2);
    expect(bodies[1]?.baseRevision).toBe(2); expect(bodies[1]?.document).toEqual(document('Newest'));
    expect(queue.dirty).toBe(false); expect(await new IndexedDBRecovery().get(value.id)).toBeUndefined();
  });
  it('retries a lost acknowledgement with the identical request and ID, including after IndexedDB recovery', async () => {
    const value = lesson(); const bodies: SaveLesson[] = []; const store = new IndexedDBRecovery();
    const queue = new Autosave(value, store, async body => { bodies.push(body); throw new TypeError('Response lost after commit'); }, () => undefined, async () => undefined);
    queues.push(queue); queue.edit(document('Committed but unacknowledged'));
    await expect(queue.flush()).rejects.toThrow('Response lost');
    expect(bodies).toHaveLength(3); expect(bodies[0]).toEqual(bodies[1]); expect(bodies[1]).toEqual(bodies[2]);
    const draft = await store.get(value.id); expect(draft?.inFlight?.body).toEqual(bodies[0]);
    queue.stop(); const recovered: SaveLesson[] = [];
    const next = new Autosave({ ...value, revision: 2 }, store, async body => { recovered.push(body); return receipt(value.id, body, 2); }, () => undefined);
    queues.push(next); next.recover(draft!);
    expect(recovered).toHaveLength(0); await next.flush();
    expect(recovered[0]).toEqual(bodies[0]); expect(next.currentRevision).toBe(2); expect(next.dirty).toBe(false);
  });
  it('pauses stale conflicts, retains the newest local JSON, and requires explicit fresh-revision overwrite', async () => {
    const value = lesson(); const store = new IndexedDBRecovery(); let conflict = true; let calls = 0;
    const queue = new Autosave(value, store, async body => { calls++; if (conflict) throw new ApiError(409, 'REVISION_CONFLICT', 'Changed in another tab', false, 2); return receipt(value.id, body, 3); }, () => undefined);
    queues.push(queue); queue.edit(document('Local'));
    await expect(queue.flush()).rejects.toThrow('Changed'); queue.edit(document('Newest local'));
    await expect(queue.flush()).rejects.toThrow('Resolve'); expect(calls).toBe(1);
    expect((await store.get(value.id))?.document).toEqual(document('Newest local'));
    conflict = false; await queue.overwriteAt(2); expect(calls).toBe(2); expect(queue.dirty).toBe(false);
  });
  it('persists genuine IndexedDB transactions and surfaces quota/storage failure while retaining notes', async () => {
    const value = lesson(); let warning = '';
    const queue = new Autosave(value, { get: async () => undefined, put: async () => { throw new Error('Quota'); }, remove: async () => { throw new Error('Quota'); } }, async body => receipt(value.id, body, 2), status => { warning = status.recoveryWarning; });
    queues.push(queue); queue.edit(document('Safe in memory')); await queue.flush();
    expect(warning).toContain('unavailable'); expect(queue.snapshot).toEqual(document('Safe in memory'));
  });
  it('keeps separate tab drafts when another tab saves and clears its own recovery copy', async () => {
    const value = lesson(); const first = new IndexedDBRecovery('first-tab'); const second = new IndexedDBRecovery('second-tab');
    const draft = { lessonId: value.id, topicId: value.topicId, baseRevision: 1, sequence: 1, acknowledged: 0, document: document('Tab one'), updatedAt: new Date().toISOString() };
    await first.put(draft); await second.put({ ...draft, document: document('Tab two') });
    await first.remove(value.id);
    expect(await first.get(value.id)).toBeUndefined();
    expect((await second.get(value.id))?.document).toEqual(document('Tab two'));
  });
  it('blocks saving and retains the unsaved indicator while the live editor has invalid content', async () => {
    const value = lesson(); let calls = 0;
    const queue = new Autosave(value, new IndexedDBRecovery(), async body => { calls++; return receipt(value.id, body, 2); }, () => undefined);
    queues.push(queue); queue.edit(document('Last valid edit')); queue.invalidate();
    await expect(queue.flush()).rejects.toThrow('invalid'); expect(calls).toBe(0); expect(queue.dirty).toBe(true);
    queue.edit(document('Corrected structure')); await queue.flush(); expect(calls).toBe(1); expect(queue.dirty).toBe(false);
  });
  it('saves after 750ms idle and by five seconds during continuous typing', async () => {
    vi.useFakeTimers(); const value = lesson(); let calls = 0;
    const memory = { get: async () => undefined, put: async () => undefined, remove: async () => undefined };
    const queue = new Autosave(value, memory, async body => { calls++; return receipt(value.id, body, 1 + calls); }, () => undefined);
    queues.push(queue); queue.edit(document('Idle')); await vi.advanceTimersByTimeAsync(749); expect(calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1); expect(calls).toBe(1);
    for (let index = 0; index < 10; index++) { queue.edit(document(`Typing ${index}`)); await vi.advanceTimersByTimeAsync(500); }
    expect(calls).toBe(2); await queue.flush(); expect(queue.dirty).toBe(false);
  });
});
