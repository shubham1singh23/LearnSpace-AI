import { randomUUID } from 'node:crypto';
import { commonMarks, editorJSON, editorSchema, modelEditOutputSchema, preparedEditSchema, textFragment, tiptapDocumentSchema, type DocumentNode, type EditRequest, type ModelEditOutput, type PreparedEdit, type SelectionTarget } from '@learnspace/shared';
import { teachingPolicy, structured } from './pipelines.js';
import type { TextAdapter } from './adapters.js';
import { ModelError } from './transport.js';

export function compileEdit(request: EditRequest, target: SelectionTarget, output: ModelEditOutput): PreparedEdit {
  const fragment = output.fragment; let formattingChanged = false;
  let content: DocumentNode[]; let kind: 'inline' | 'blocks';
  if (request.mode === 'replace') {
    kind = target.kind;
    if (target.kind === 'inline') {
      if (fragment.kind !== 'inline') throw new ModelError('INVALID_OUTPUT');
      const selection = target.blocks[0]!;
      const blockStartOffset = target.from - (target.anchor - editorSchema.nodeFromJSON(selection).nodeSize + 1);
      const selected = editorSchema.nodeFromJSON(selection).content.cut(blockStartOffset, blockStartOffset + target.to - target.from);
      const nodes = tiptapDocumentSchema.parse({ type: 'doc', content: [{ type: 'paragraph', attrs: selection.attrs && { blockId: selection.attrs.blockId }, content: editorJSON(selected.toJSON()) }] }).content[0]!.content ?? [];
      const marks = commonMarks(nodes);
      formattingChanged = marks.mixed; content = textFragment(fragment.text, marks.marks);
    } else {
      if (fragment.kind !== 'block_texts' || fragment.items.length !== target.blocks.length) throw new ModelError('INVALID_OUTPUT');
      content = target.blocks.map((block, index) => { const marks = commonMarks(block.content ?? []); formattingChanged ||= marks.mixed; return { ...block, content: textFragment(fragment.items[index]!.text, marks.marks) }; });
    }
  } else {
    kind = 'blocks';
    if (fragment.kind !== 'insert_blocks') throw new ModelError('INVALID_OUTPUT');
    if (request.action === 'example' || request.action === 'analogy') { if (fragment.blocks.length !== 1 || fragment.blocks[0]?.type !== request.action) throw new ModelError('INVALID_OUTPUT'); }
    else if (request.action === 'explain' && fragment.blocks.some(block => block.type !== 'paragraph')) throw new ModelError('INVALID_OUTPUT');
    content = fragment.blocks.map(block => {
      const paragraph: DocumentNode = { type: 'paragraph', attrs: { blockId: randomUUID() }, content: textFragment(block.text) };
      return block.type === 'paragraph' ? paragraph : { type: block.type === 'example' ? 'exampleBlock' : 'analogyBlock', attrs: { blockId: randomUUID(), label: block.type === 'example' ? 'Example' : 'Analogy' }, content: [paragraph] };
    });
  }
  return preparedEditSchema.parse({ action: request.action, mode: request.mode, target, fragment: { kind, content }, formattingChanged, ...(output.explanation ? { explanation: output.explanation } : {}) });
}
export async function generateEdit(adapter: TextAdapter, request: EditRequest, target: SelectionTarget, context: string, signal: AbortSignal) {
  const shape = request.mode === 'insert_after' ? '{kind:"insert_blocks",blocks:[{type:"paragraph|example|analogy",text:string}]}' : target.kind === 'inline' ? '{kind:"inline",text:string}' : `{kind:"block_texts",items:[{text:string}]} with exactly ${target.blocks.length} items`;
  const policy = `${teachingPolicy} Perform only the requested selection action: ${request.action}. Return JSON {fragment:${shape},explanation?:string}. Explain inserts paragraph explanations; example/analogy insert exactly one matching labelled block. Simplify uses simpler wording, expand adds detail, rewrite improves wording while preserving meaning. Custom follows explicit mode/instructions. Do not output HTML, IDs, attrs, assets, offsets, marks or document roots. Replacement retains existing block shells. Maximum 32 KiB output; use concise nonempty Unicode text.`;
  const output = await structured(adapter, policy, JSON.stringify({ action: request.action, instruction: request.instruction, selectedText: target.text, context }), modelEditOutputSchema, signal);
  return compileEdit(request, target, output);
}
