import { expect, it } from 'vitest';
import { educationalLessonSchema, editorJSON, editorSchema, tiptapDocumentSchema, type DocumentNode } from '@learnspace/shared';
import { compileLesson } from './compiler.js';

export const teachingFixture = educationalLessonSchema.parse({ title: 'Addition', objectives: ['Add two numbers'], prerequisiteNotes: ['Know counting'], sections: [{ heading: 'Counting together', blocks: [
  { type: 'paragraph', text: '<script>not executable</script> One plus one is two.' }, { type: 'example', text: 'One apple and one apple make two apples.' }, { type: 'analogy', text: 'Join two small groups.' }, { type: 'reflection', text: 'Where do you count groups?' }, { type: 'list', ordered: true, items: ['Count first group', 'Count second group'] }, { type: 'code', language: 'js', text: '1 + 1' }, { type: 'math', latex: '1+1=2' }, { type: 'table', headers: ['First', 'Second'], rows: [['1', '1']] }
] }], recall: [{ question: 'One plus one?', answer: 'Two' }], uncertainties: ['Examples are simplified.'], sources: [{ title: 'Unverified example', url: 'https://example.com/' }] });
it('compiles every teaching block into canonical editor content with unique IDs and paired recall metadata', () => {
  const document = compileLesson(teachingFixture); const ids: string[] = []; const recall: string[] = [];
  const visit = (node: DocumentNode) => { if (typeof node.attrs?.blockId === 'string') ids.push(node.attrs.blockId); if (node.attrs?.learningRole === 'recall_question' || node.attrs?.learningRole === 'recall_answer') recall.push(String(node.attrs.learningGroupId)); node.content?.forEach(visit); };
  visit(document); expect(new Set(ids).size).toBe(ids.length); expect(recall).toHaveLength(2); expect(recall[0]).toBe(recall[1]);
  const reloaded = tiptapDocumentSchema.parse(editorJSON(editorSchema.nodeFromJSON(document).toJSON())); expect(reloaded).toEqual(document);
  expect(JSON.stringify(document)).toContain('Model supplied sources'); expect(JSON.stringify(document)).not.toContain('"type":"image"');
  expect(compileLesson(teachingFixture)).not.toEqual(document);
});
