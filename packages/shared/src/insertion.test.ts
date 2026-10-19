import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { captureInsertion, transformInsertion } from './insertion.js';
import { fingerprint } from './edit-contracts.js';
import type { TiptapDocument } from './document.js';

it('inserts literal text and hard breaks preserving the surrounding block, metadata and marks', async () => {
  const document: TiptapDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: randomUUID(), learningRole: 'reflection' }, content: [{ type: 'text', text: 'A🧠B', marks: [{ type: 'bold' }] }] }, { type: 'paragraph', attrs: { blockId: randomUUID() }, content: [{ type: 'text', text: 'Untouched' }] }] };
  const text = '<b>literal</b>\nAnswer';
  const metadata = { lessonId: randomUUID(), baseRevision: 1, editorInstanceId: randomUUID(), documentSequence: 0, localSequence: 0, source: { kind: 'chat_insert' as const, sourceHash: await fingerprint(text) } };
  await expect(captureInsertion(document, 3, metadata)).rejects.toThrow('surrogate');
  const anchor = await captureInsertion(document, 4, metadata); const result = await transformInsertion(document, anchor, text);
  expect(result.document.content[0]?.attrs).toEqual(document.content[0]?.attrs); expect(result.document.content[1]).toEqual(document.content[1]);
  expect(result.document.content[0]?.content).toEqual([{ type: 'text', text: 'A🧠', marks: [{ type: 'bold' }] }, { type: 'text', text: '<b>literal</b>' }, { type: 'hardBreak' }, { type: 'text', text: 'Answer' }, { type: 'text', text: 'B', marks: [{ type: 'bold' }] }]);
  await expect(transformInsertion(document, anchor, 'Changed')).rejects.toThrow('source');
  const changed = structuredClone(document); changed.content[1]!.content![0]!.text = 'Outside edit'; await expect(transformInsertion(changed, anchor, text)).rejects.toThrow('stale');
});
it('supports safe nested text cursors and rejects structural/code cursors', async () => {
  const document: TiptapDocument = { type: 'doc', content: [{ type: 'blockquote', attrs: { blockId: randomUUID() }, content: [{ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [{ type: 'text', text: 'Nested' }] }] }] };
  const metadata = { lessonId: randomUUID(), baseRevision: 1, editorInstanceId: randomUUID(), documentSequence: 0, localSequence: 0, source: { kind: 'recall_insert' as const, sourceHash: await fingerprint('Answer') } };
  const anchor = await captureInsertion(document, 2, metadata); expect((await transformInsertion(document, anchor, 'Answer')).steps).toHaveLength(1);
  await expect(captureInsertion(document, 1, metadata)).rejects.toThrow('paragraph');
});
