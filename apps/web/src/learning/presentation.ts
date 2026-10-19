import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { DocumentNode, TiptapDocument } from '@learnspace/shared';

export const readingKey = new PluginKey<ReadonlySet<string>>('learningPresentation');
export const readingPlugin = new Plugin<ReadonlySet<string>>({
  key: readingKey,
  state: { init: () => new Set(), apply: (tr, prior) => { const next: unknown = tr.getMeta(readingKey); return next instanceof Set ? next as Set<string> : prior; } },
  props: { decorations(state) { const hidden = readingKey.getState(state)!; const decorations: Decoration[] = []; state.doc.descendants((node, pos) => { if (typeof node.attrs.blockId === 'string' && hidden.has(node.attrs.blockId)) { decorations.push(Decoration.node(pos, pos + node.nodeSize, { style: 'display:none', 'aria-hidden': 'true' })); return false; } }); return DecorationSet.create(state.doc, decorations); } }
});
export const learningText = (node: DocumentNode): string => node.text ?? (node.type === 'hardBreak' ? '\n' : node.content?.map(learningText).join('') ?? '');
export function learningProjection(document: TiptapDocument) {
  const groups = new Map<string, { role: string; node: DocumentNode; order: number }[]>(); const reflections: string[] = []; let order = 0;
  const visit = (node: DocumentNode) => {
    const role = node.attrs?.learningRole; const id = node.attrs?.blockId; const group = node.attrs?.learningGroupId;
    if (role === 'reflection' && typeof id === 'string') reflections.push(id);
    if ((role === 'recall_question' || role === 'recall_answer') && typeof group === 'string') groups.set(group, [...(groups.get(group) ?? []), { role, node, order }]);
    order++; node.content?.forEach(visit);
  }; document.content.forEach(visit);
  const pairs = [...groups].flatMap(([id, entries]) => { const q = entries.filter(entry => entry.role === 'recall_question'); const a = entries.filter(entry => entry.role === 'recall_answer'); return entries.length === 2 && q.length === 1 && a.length === 1 && q[0]!.order < a[0]!.order ? [{ id, question: q[0]!.node, answer: a[0]!.node }] : []; });
  const paired = new Set(pairs.flatMap(pair => [pair.question, pair.answer])); let malformed = false;
  const check = (node: DocumentNode) => { if (['recall_question', 'recall_answer'].includes(String(node.attrs?.learningRole)) && !paired.has(node)) malformed = true; node.content?.forEach(check); }; document.content.forEach(check);
  let section = 0; const sections = document.content.map((node, index) => { if (node.type === 'heading' && index > 0) section++; return { node, section }; });
  return { pairs, reflections, malformed, sections, sectionCount: document.content.length ? section + 1 : 1 };
}
export function hiddenLearningBlocks(document: TiptapDocument, options: { reading: boolean; guided: boolean; section: number; reflectionPauses: boolean; continued: ReadonlySet<string>; revealed: ReadonlySet<string>; showAll: boolean }) {
  const hidden = new Set<string>(); if (!options.reading || options.showAll) return hidden;
  const projection = learningProjection(document);
  // Malformed recall metadata never hides content through any presentation gate.
  if (projection.malformed) return hidden;
  for (const pair of projection.pairs) if (!options.revealed.has(pair.id)) hidden.add(String(pair.answer.attrs?.blockId));
  let paused = false;
  const reflect = (node: DocumentNode) => {
    const id = node.attrs?.blockId;
    if (paused && typeof id === 'string') { hidden.add(id); return; }
    if (options.reflectionPauses && node.attrs?.learningRole === 'reflection' && typeof id === 'string' && !options.continued.has(id)) paused = true;
    else node.content?.forEach(reflect);
  };
  for (const { node, section } of projection.sections) {
    const id = String(node.attrs?.blockId);
    if (options.guided && section !== options.section) { hidden.add(id); continue; }
    reflect(node);
  }
  return hidden;
}
