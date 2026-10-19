import { Node, Mark, getSchema, type Extensions } from '@tiptap/core';

// One extension set supplies both the browser editor and headless server schema.
const blockAttrs = { blockId: { default: null } };
const learningAttrs = { learningRole: { default: null }, learningGroupId: { default: null } };
function container(name: string, tag: string, content: string, extra = {}, group = 'block') {
  return Node.create({ name, group, content, addAttributes: () => ({ ...blockAttrs, ...extra }),
    parseHTML: () => [{ tag }], renderHTML: ({ HTMLAttributes }) => [tag.split('[')[0]!, { ...HTMLAttributes, ...(name === 'exampleBlock' ? { 'data-example': '' } : name === 'analogyBlock' ? { 'data-analogy': '' } : {}) }, 0] });
}
function atom(name: string, tag: string, extra = {}, inline = false) {
  return Node.create({ name, group: inline ? 'inline' : 'block', inline, atom: true,
    addAttributes: () => ({ ...(inline ? {} : blockAttrs), ...extra }),
    parseHTML: () => [{ tag }], renderHTML: ({ node, HTMLAttributes }) => name === 'image'
      ? ['figure', { 'data-type': name }, ['img', { src: `/api/v1/assets/${String(node.attrs.assetId)}/content`, alt: String(node.attrs.alt), width: node.attrs.width, height: node.attrs.height }], ['figcaption', {}, String(node.attrs.caption ?? '')]]
      : [tag.split('[')[0]!, { ...HTMLAttributes, ...(name === 'mathInline' ? { 'data-math-inline': '' } : { 'data-math-block': '' }) }, String(node.attrs.latex ?? '')] });
}
export const documentExtensions: Extensions = [
  Node.create({ name: 'doc', topNode: true, content: 'block+' }),
  Node.create({ name: 'text', group: 'inline' }),
  container('paragraph', 'p', 'inline*', learningAttrs),
  Node.create({ name: 'heading', group: 'block', content: 'inline*', defining: true,
    addAttributes: () => ({ ...blockAttrs, ...learningAttrs, level: { default: 2 } }),
    parseHTML: () => [1, 2, 3, 4, 5, 6].map(level => ({ tag: `h${level}`, attrs: { level } })),
    renderHTML: ({ node, HTMLAttributes }) => [`h${String(node.attrs.level)}`, HTMLAttributes, 0] }),
  Node.create({ name: 'hardBreak', inline: true, group: 'inline', selectable: false, parseHTML: () => [{ tag: 'br' }], renderHTML: () => ['br'] }),
  container('bulletList', 'ul', 'listItem+'),
  container('orderedList', 'ol', 'listItem+', { start: { default: 1 } }),
  container('listItem', 'li', 'paragraph block*', {}, ''),
  container('blockquote', 'blockquote', 'block+'),
  Node.create({ name: 'horizontalRule', group: 'block', atom: true, addAttributes: () => blockAttrs, parseHTML: () => [{ tag: 'hr' }], renderHTML: ({ HTMLAttributes }) => ['hr', HTMLAttributes] }),
  Node.create({ name: 'codeBlock', group: 'block', content: 'text*', marks: '', code: true, defining: true,
    addAttributes: () => ({ ...blockAttrs, language: { default: null } }),
    parseHTML: () => [{ tag: 'pre', preserveWhitespace: 'full' }], renderHTML: ({ HTMLAttributes }) => ['pre', HTMLAttributes, ['code', {}, 0]] }),
  container('table', 'table', 'tableRow+'), container('tableRow', 'tr', '(tableCell | tableHeader)+', {}, ''),
  container('tableHeader', 'th', 'block+', {}, ''), container('tableCell', 'td', 'block+', {}, ''),
  atom('mathInline', 'span[data-math-inline]', { latex: { default: '' } }, true),
  atom('mathBlock', 'div[data-math-block]', { latex: { default: '' } }),
  container('exampleBlock', 'section[data-example]', 'block+', { label: { default: null } }),
  container('analogyBlock', 'section[data-analogy]', 'block+', { label: { default: null } }),
  atom('image', 'figure[data-type="image"]', { assetId: { default: null }, alt: { default: '' }, caption: { default: null }, width: { default: null }, height: { default: null } }),
  ...(['bold', 'italic', 'strike', 'underline', 'code'] as const).map((name, index) => {
    const tag = ['strong', 'em', 's', 'u', 'code'][index]!;
    return Mark.create({ name, code: name === 'code', excludes: name === 'code' ? '_' : '', parseHTML: () => [{ tag }], renderHTML: () => [tag, {}, 0] });
  }),
  Mark.create({ name: 'link', inclusive: false, addAttributes: () => ({ href: { default: null } }),
    parseHTML: () => [{ tag: 'a[href]' }], renderHTML: ({ HTMLAttributes }) => ['a', { ...HTMLAttributes, rel: 'noopener noreferrer' }, 0] })
];
export const editorSchema = getSchema(documentExtensions);

// Tiptap emits null defaults and omits empty content. Normalize only these known
// serialization differences; validate untrusted input before calling this helper.
export function editorJSON(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(editorJSON);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'attrs' && item && typeof item === 'object') {
      result.attrs = Object.fromEntries(Object.entries(item).filter(([, attribute]) => attribute !== null));
    } else result[key] = editorJSON(item);
  }
  if (['paragraph', 'heading', 'codeBlock'].includes(String(result.type)) && !result.content) result.content = [];
  return result;
}
