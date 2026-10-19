import { randomUUID } from 'node:crypto';
import type { DocumentNode } from '@learnspace/shared';
export const block = (type: DocumentNode['type'], content?: DocumentNode[], extra = {}): DocumentNode => ({ type, attrs: { blockId: randomUUID(), ...extra }, ...(content ? { content } : {}) });
const paragraph = () => block('paragraph', []);
export function allNodesFixture() {
  return { type: 'doc', content: [
    block('heading', [{ type: 'text', text: 'Heading' }], { level: 6 }),
    block('paragraph', [
      ...(['bold', 'italic', 'strike', 'underline', 'code'] as const).map(type => ({ type: 'text' as const, text: type, marks: [{ type }] })),
      { type: 'text', text: 'safe link', marks: [{ type: 'link', attrs: { href: 'https://example.org' } }] },
      { type: 'hardBreak' }, { type: 'mathInline', attrs: { latex: 'x^2' } }
    ], { learningRole: 'recall_answer', learningGroupId: randomUUID() }),
    block('bulletList', [block('listItem', [paragraph()])]),
    block('orderedList', [block('listItem', [paragraph()])], { start: 3 }),
    block('blockquote', [paragraph()]), block('horizontalRule'),
    block('codeBlock', [{ type: 'text', text: 'const x = "🙂";\n' }], { language: 'typescript' }),
    block('table', [block('tableRow', [block('tableHeader', [paragraph()]), block('tableCell', [paragraph()])])]),
    block('mathBlock', undefined, { latex: '\\sum_i x_i' }),
    block('exampleBlock', [paragraph()], { label: 'Worked example' }), block('analogyBlock', [paragraph()], { label: 'Analogy' }),
    block('image', undefined, { assetId: randomUUID(), alt: 'Diagram', caption: 'Caption', width: 640, height: 480 })
  ] };
}

