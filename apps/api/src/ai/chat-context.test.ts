import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { defaultPreferences, modelSnapshotSchema } from '@learnspace/shared';
import { chatSystem } from '@learnspace/ai';
import { selectChatContext, type ChatContextInput } from './chat-context.js';

const model = modelSnapshotSchema.parse({ version: 1, configId: randomUUID(), configRevision: 1, provider: 'ollama', modelId: 'fake', options: {}, capabilities: { structuredOutput: 'prompt_json', streaming: 'unknown', vision: 'unsupported', toolCalling: 'unknown', imageGeneration: 'unsupported', contextWindow: 16384, maxOutputTokens: 8192, registryVersion: 'test', source: 'test' } });
const paragraph = (text: string) => ({ type: 'paragraph', attrs: { blockId: randomUUID() }, content: [{ type: 'text', text }] });
function fixture(): ChatContextInput { return { question: 'Explain recursion', selectedBlockIds: [], treeRevision: 1, goal: 'Learn', preferences: defaultPreferences, path: ['Course', 'Topic'], objectives: [], current: { id: randomUUID(), revision: 3, document: { type: 'doc', content: [paragraph('Saved edited recursion 🧠 é')] } }, prerequisites: [], history: [] }; }
it('captures whole Unicode blocks deterministically and labels exact revisions and IDs', () => {
  const f = fixture(); const first = selectChatContext(f, model); expect(selectChatContext(f, model)).toEqual(first);
  expect(first.input).toContain('Saved edited recursion 🧠 é'); expect(first.input).not.toContain('�');
  expect(first.context.sources[0]?.revision).toBe(3); expect(first.context.chat?.contextHash).toHaveLength(64);
  expect(Buffer.byteLength(chatSystem + first.input)).toBeLessThanOrEqual(12000);
});
it('omits oversized optional blocks without losing later useful text or splitting code/math', () => {
  const f = fixture(); const codeId = randomUUID(); const mathId = randomUUID();
  f.current.document = { type: 'doc', content: [paragraph('x'.repeat(14000)), { type: 'codeBlock', attrs: { blockId: codeId, language: 'sql' }, content: [{ type: 'text', text: 'SELECT 1;' }] }, { type: 'mathBlock', attrs: { blockId: mathId, latex: 'x^2' } }, paragraph('Useful recursion notes')] };
  const result = selectChatContext(f, model); expect(result.context.omitted).toBe(true); expect(result.input).toContain('SELECT 1;'); expect(result.input).toContain('x^2'); expect(result.input).toContain('Useful recursion notes'); expect(result.input).not.toContain('x'.repeat(1000));
  expect(result.context.sources[0]?.blockIds).toContain(codeId); expect(result.context.sources[0]?.blockIds).toContain(mathId);
});
it('rejects oversized mandatory selections, unsafe IDs and tiny configurations before invocation', () => {
  const f = fixture(); const node = paragraph('x'.repeat(14000)); f.current.document = { type: 'doc', content: [node] }; f.selectedBlockIds = [node.attrs.blockId];
  expect(() => selectChatContext(f, model)).toThrow('selected complete block'); f.selectedBlockIds = [randomUUID()]; expect(() => selectChatContext(f, model)).toThrow('eligible saved text');
  expect(() => selectChatContext(fixture(), { ...model, capabilities: { ...model.capabilities, contextWindow: 2048 } })).toThrow('budget');
});
it('bounds complete history pairs and prerequisites, discloses missing and image context', () => {
  const f = fixture(); f.history = Array.from({ length: 8 }, (_, index) => ({ user: { id: randomUUID(), content: `Question ${index}` }, assistant: { id: randomUUID(), content: `Answer ${index}` } }));
  f.current.document = { type: 'doc', content: [paragraph('Saved current notes'), { type: 'image', attrs: { blockId: randomUUID(), assetId: randomUUID(), alt: 'Not a visual model input', width: 8, height: 6 } }] };
  f.prerequisites = [{ title: 'Skipped', choice: 'skip', lesson: { id: randomUUID(), revision: 2, document: { type: 'doc', content: [paragraph('Saved prerequisite')] } } }, { title: 'Missing', choice: 'study', lesson: null }];
  const result = selectChatContext(f, model); expect(result.context.chat?.historyMessageIds).toHaveLength(12); expect(result.input).not.toContain('Question 0'); expect(result.input).toContain('Question 7'); expect(result.input).toContain('skip'); expect(result.context.chat?.omissions).toContain('missing_prerequisite'); expect(result.context.sources).toHaveLength(2);
  expect(result.context.chat?.omissions).toContain('unsupported_media'); expect(result.input).not.toContain('Not a visual model input');
});
