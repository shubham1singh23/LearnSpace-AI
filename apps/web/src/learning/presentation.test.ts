import { expect, it } from 'vitest';
import type { DocumentNode, TiptapDocument } from '@learnspace/shared';
import { hiddenLearningBlocks, learningProjection } from './presentation';
const node = (text: string, attrs: Record<string, string | number> = {}): DocumentNode => ({ type: 'paragraph', attrs: { blockId: crypto.randomUUID(), ...attrs }, content: [{ type: 'text', text }] });
const options = { reading: true, guided: false, section: 0, reflectionPauses: true, continued: new Set<string>(), revealed: new Set<string>(), showAll: false };
it('pairs only unique ordered recall groups and safely reveals malformed metadata', () => {
  const group = crypto.randomUUID(); const question = node('Question', { learningRole: 'recall_question', learningGroupId: group }); const answer = node('Answer', { learningRole: 'recall_answer', learningGroupId: group }); const document: TiptapDocument = { type: 'doc', content: [question, answer] };
  expect(learningProjection(document).pairs).toHaveLength(1); expect(hiddenLearningBlocks(document, options).has(String(answer.attrs?.blockId))).toBe(true);
  expect(hiddenLearningBlocks(document, { ...options, revealed: new Set([group]) }).size).toBe(0);
  for (const content of [[answer, question], [question], [question, answer, node('Duplicate', { learningRole: 'recall_answer', learningGroupId: group })]]) { const invalid: TiptapDocument = { type: 'doc', content }; expect(learningProjection(invalid).malformed).toBe(true); expect(hiddenLearningBlocks(invalid, options).size).toBe(0); }
});
it('gates sections and nested reflection without changing source JSON; edit/show-all always expose everything', () => {
  const reflection = node('Think', { learningRole: 'reflection' }); const after = node('Later'); const heading = { ...node('Next'), type: 'heading' as const, attrs: { blockId: crypto.randomUUID(), level: 2 } };
  const document: TiptapDocument = { type: 'doc', content: [{ type: 'blockquote', attrs: { blockId: crypto.randomUUID() }, content: [reflection, after] }, heading] }; const before = structuredClone(document);
  expect(hiddenLearningBlocks(document, options).has(String(after.attrs?.blockId))).toBe(true);
  expect(hiddenLearningBlocks(document, { ...options, continued: new Set([String(reflection.attrs?.blockId)]) }).size).toBe(0);
  expect(hiddenLearningBlocks(document, { ...options, reading: false }).size).toBe(0); expect(hiddenLearningBlocks(document, { ...options, showAll: true }).size).toBe(0); expect(document).toEqual(before);
  expect(learningProjection(document).sectionCount).toBe(2);
});
it('uses curated subject fixtures only as deterministic metadata/rubric evidence, not live factual verification', () => {
  for (const [subject, question, answer] of [['fractions', 'What is 1/2 + 1/2?', '1'], ['recursion', 'What stops recursion?', 'A base case'], ['SQL joins', 'What does INNER JOIN retain?', 'Rows matching the join condition'], ['tokenization', 'Are tokens always words?', 'No'], ['LangChain', 'Does a model invocation require an agent?', 'No']]) {
    const group = crypto.randomUUID(); const document: TiptapDocument = { type: 'doc', content: [node(subject!), node(question!, { learningRole: 'recall_question', learningGroupId: group }), node(answer!, { learningRole: 'recall_answer', learningGroupId: group })] };
    expect(learningProjection(document).pairs).toHaveLength(1); expect(learningProjection(document).malformed).toBe(false);
  }
});
