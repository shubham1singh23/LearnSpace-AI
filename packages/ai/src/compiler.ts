import { randomUUID } from 'node:crypto';
import { educationalLessonSchema, tiptapDocumentSchema, type DocumentNode, type EducationalLesson } from '@learnspace/shared';

const attrs = () => ({ blockId: randomUUID() });
const text = (value: string): DocumentNode[] => [{ type: 'text', text: value }];
const paragraph = (value: string): DocumentNode => ({ type: 'paragraph', attrs: attrs(), content: text(value) });
const heading = (value: string, level: number): DocumentNode => ({ type: 'heading', attrs: { ...attrs(), level }, content: text(value) });
function block(value: EducationalLesson['sections'][number]['blocks'][number]): DocumentNode {
  switch (value.type) {
    case 'paragraph': return paragraph(value.text);
    case 'example': case 'analogy': return { type: value.type === 'example' ? 'exampleBlock' : 'analogyBlock', attrs: { ...attrs(), label: value.type === 'example' ? 'Worked example' : 'Analogy' }, content: [paragraph(value.text)] };
    case 'reflection': return { type: 'paragraph', attrs: { ...attrs(), learningRole: 'reflection', learningGroupId: randomUUID() }, content: text(`Reflection: ${value.text}`) };
    case 'code': return { type: 'codeBlock', attrs: { ...attrs(), language: value.language }, content: text(value.text) };
    case 'math': return { type: 'mathBlock', attrs: { ...attrs(), latex: value.latex } };
    case 'list': return { type: value.ordered ? 'orderedList' : 'bulletList', attrs: value.ordered ? { ...attrs(), start: 1 } : attrs(), content: value.items.map(item => ({ type: 'listItem', attrs: attrs(), content: [paragraph(item)] })) };
    case 'table': return { type: 'table', attrs: attrs(), content: [value.headers, ...value.rows].map((row, index) => ({ type: 'tableRow', attrs: attrs(), content: row.map(cell => ({ type: index === 0 ? 'tableHeader' : 'tableCell', attrs: attrs(), content: [paragraph(cell)] })) })) };
  }
}
export function compileLesson(input: EducationalLesson) {
  const lesson = educationalLessonSchema.parse(input);
  const content: DocumentNode[] = [heading(lesson.title, 1), heading('Learning objectives', 2), ...lesson.objectives.map(paragraph)];
  if (lesson.prerequisiteNotes.length) content.push(heading('Prerequisite notes', 2), ...lesson.prerequisiteNotes.map(paragraph));
  for (const section of lesson.sections) content.push(heading(section.heading, 2), ...section.blocks.map(block));
  content.push(heading('Active recall', 2));
  for (const recall of lesson.recall) {
    const learningGroupId = randomUUID();
    content.push({ type: 'paragraph', attrs: { ...attrs(), learningRole: 'recall_question', learningGroupId }, content: text(`Question: ${recall.question}`) }, { type: 'paragraph', attrs: { ...attrs(), learningRole: 'recall_answer', learningGroupId }, content: text(`Answer: ${recall.answer}`) });
  }
  if (lesson.uncertainties.length) content.push(heading('Uncertainties to review', 2), ...lesson.uncertainties.map(paragraph));
  if (lesson.sources?.length) content.push(heading('Model supplied sources — unverified', 2), ...lesson.sources.map(source => paragraph(`${source.title}: ${source.url}`)));
  return tiptapDocumentSchema.parse({ type: 'doc', content });
}
