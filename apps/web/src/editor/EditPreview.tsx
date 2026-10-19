import type { PreparedEdit } from '@learnspace/shared';

export function EditPreview({ prepared }: { prepared: PreparedEdit }) {
  const text = (node: PreparedEdit['fragment']['content'][number]): string => node.text ?? (node.type === 'hardBreak' ? '\n' : node.content?.map(text).join(node.type === 'paragraph' ? '' : '\n') ?? '');
  const proposed = prepared.fragment.content.map(text).join(prepared.fragment.kind === 'inline' ? '' : '\n');
  return <section aria-label="Selection proposal preview"><h4>{prepared.mode === 'replace' ? 'Replace captured selection' : 'Insert after captured block'}</h4>
    <h5>Original selection</h5><pre>{prepared.target.text}</pre><h5>Proposed content</h5><pre>{proposed}</pre>
    {prepared.formattingChanged ? <p>Formatting change: mixed marks inside the replacement become only their common marks. Unselected formatting is preserved.</p> : <p>Existing block metadata and unselected formatting are preserved. Inserted blocks use new identities.</p>}
    {prepared.explanation && <p>{prepared.explanation}</p>}<p>AI content may be inaccurate. Review before accepting.</p>
    <button onClick={() => { void navigator.clipboard.writeText(proposed); }}>Copy proposal text</button>
  </section>;
}
