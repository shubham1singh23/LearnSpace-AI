# Editor, persistence, and AI editing

Proposed contract. Dependencies: [database](DATABASE.md), [API](API.md), [AI](AI_DESIGN.md).

## Canonical document schema

Persist `{type:'doc', content:[...]}` as JSONB, with `Lesson.documentSchemaVersion=1` outside the document. Empty notes have one paragraph. All schema-bearing changes require migration fixtures and export handling before enabling the extension. Reject unsupported nodes/marks rather than silently stripping them. Both server and browser validate node types, attrs, nesting, node count, byte size, URLs, unique block IDs, and referenced asset ownership.

| Nodes/marks | Canonical details | Export contract |
|---|---|---|
| paragraph, heading | UUID `blockId`; heading level 1-6 | Paragraph / heading |
| text, hardBreak; bold, italic, strike, underline, code, link | Safe link href; no arbitrary HTML attrs | Supported marks; underline/strike may use safe Markdown HTML or documented text fallback |
| bulletList, orderedList, listItem | Ordered start retained; block IDs on structural blocks | Nested lists and start numbers |
| blockquote, horizontalRule | Stable IDs | Quote / rule |
| codeBlock | `language` normalized string; literal text only | Fence / styled code paragraph |
| table, tableRow, tableHeader, tableCell | IDs; bounded rows/cols; initial MVP disallows merged cells | Pipe table / DOCX table |
| mathInline, mathBlock | Validated bounded LaTeX string; no executable commands | LaTeX delimiters / labeled equation text |
| exampleBlock, analogyBlock | Label plus block content and stable ID | Labeled section / styled paragraphs |
| image | assetId, alt, caption, width/height; server derives URL | Relative link / embedded image |

Use Tiptap extension configuration shared with server validation through schema contracts; server must not trust JSON merely because it is Zod-shaped. Prefer a server-side ProseMirror schema check plus semantic checks. Stable IDs may use Tiptap UniqueID after compatibility/license review, or a small local extension; copied blocks receive fresh IDs. Splits keep one old ID and create a new ID; joins retire one ID. Never match a target by text search alone.

Reflection/recall use ordinary paragraph/heading blocks with optional allowlisted attrs `learningRole: reflection|recall_question|recall_answer` and `learningGroupId: UUID` to pair question/answer blocks. No attrs means ordinary prose. These attrs and text survive JSON validation, version restore and export; they never authorize AI writes. In read mode, guided pace/reflectionPauses control temporary reveal decorations; edit mode always exposes all blocks. Revealed state and scratch recall answers are transient UI state. Learners explicitly insert an answer into notes to persist it. No graded attempts table or mastery calculation in MVP. Export renders all blocks with readable labels regardless of reveal state.

An example stored document:

```json
{"type":"doc","content":[{"type":"heading","attrs":{"blockId":"a8e08fb7-53ed-4c41-bdab-029b62deea72","level":2},"content":[{"type":"text","text":"Tokenization"}]},{"type":"paragraph","attrs":{"blockId":"fd605884-451d-4e87-987e-c2bff1889bc7"},"content":[{"type":"text","text":"Tokens are model input units."}]}]}
```

## Editor lifecycle and autosave state machine

Load saved JSON once for a lesson ID/revision; never replace live editor state when an unrelated query refetch completes. Keep server revision, local edit sequence, acknowledged sequence, dirty JSON, and in-flight request separately. A transaction updates local sequence and recovery draft; selection-only transactions do not trigger saves.

1. After 750 ms idle (max 5 seconds while continuously typing), capture immutable JSON and local sequence and queue a save. Only one request in flight per lesson; coalesce unsent snapshots to the newest.
2. Send `baseRevision`, UUID `mutationId`, full document and schema version. A retry uses exactly the same body and ID. Store canonical request hash and unique `(lessonId,mutationId)` receipt so a lost response can be replayed; changed payload with reused ID returns 409.
3. On success, advance server revision and acknowledged sequence only for that snapshot. Newer typing remains dirty and queues against the returned revision. Never call `setContent` using the save response.
4. On retryable failure, retain JSON and recovery draft; show unsaved state and bounded backoff with explicit retry. Abort is not proof the server did not commit; retry with the same mutation ID.
5. On 409, pause the queue. Fetch server JSON separately. Show local and remote copies; offer copy/download local recovery JSON, load server after confirmation, or explicitly overwrite using the freshly read revision. No blind retry or automatic whole-document merge. Another race produces another conflict.
6. On navigation, await an empty queue AND `acknowledgedSequence === localSequence`; briefly prevent new edits during final route transition. Failure blocks navigation with retry/stay/recovery options. `beforeunload` warns if dirty; asynchronous unload saving is not guaranteed. IndexedDB recovery mitigates crash loss, but cannot promise saving every keystroke before a browser/OS crash.

Undo/redo uses local ProseMirror history, including accepted AI changes as one event. Undo is another document change and autosaves as a new revision; it does not decrement revision. History need not survive reload; saved versions do. Multiple tabs are supported through CAS conflicts, not collaborative editing.

## Capturing a selection

Flush notes first so model context corresponds to a saved revision. Capture lessonId, baseRevision, local document sequence, `from/to` positions, start/end block IDs, selected ProseMirror slice, selected text, nearby bounded text, SHA-256 of canonical selected slice, and a boundary fingerprint for insertion. Retain the editor instance identity and operation ID. Positions are browser-owned metadata; the LLM never supplies them. Backend verifies range/slice against the saved document with the same schema and computes authoritative hashes. Initial MVP permits text ranges inside one paragraph/heading and whole contiguous text blocks; reject partial table/list structural selections and image selections with an explanation. Direct editing remains available everywhere.

| Action | Proposed result | Application |
|---|---|---|
| Explain | Text/block explanation | Preview with explicit Insert below option |
| Simplify, expand, rewrite | Validated inline or block slice | Replace only captured range |
| Custom | Validated slice matching explicit mode | Replace captured range or insert after final selected block |
| Example / analogy | Typed labeled block | Insert after selected containing block |

Custom instructions must choose replace or insert explicitly. Paragraph replacement uses inline content; multi-block replacement must be a schema-valid block slice. AI must not return document roots, target offsets, block IDs, image references, or arbitrary attrs; server assigns safe proposal IDs where needed. Preserve marks outside selection; do not arbitrarily extend selection to the entire paragraph.

## Preview, acceptance, and stale handling

Display original and proposed content, action, and model identity. Streaming previews are provisional, noneditable, and cannot be accepted until full validation. Reject transitions the operation to rejected and makes zero editor changes.

For MVP, a plugin records the captured local document sequence; ANY document-changing transaction after capture invalidates acceptance. This includes another accepted AI response, image insertion, and later edits that happen to restore the same text. Selection-only movement is safe. A server revision change from another tab also invalidates the operation. Do not build a transaction-mapping/rebasing subsystem while this strict rule is in effect; add mapping only under a later decision relaxing the rule.

On accept, pause editing, flush pending saves, and recheck local sequence, editor identity, revision, block IDs, range hash and ready proposal. Dispatch exactly one local transaction (`replaceRange`/`insertContentAt` with schema validation), assigning any fresh block IDs in the server-prepared proposal. Immediately save this isolated JSON with `aiOperationId` and a new mutationId; do not debounce or coalesce acceptance with subsequent typing. Keep the editor read-only until the outcome is known (on a prolonged outage allow explicit recovery/copy, not silent discard). The server independently reconstructs the transformation using shared pure document-schema/fragment helpers; it compares the submitted hash and atomically updates document/history and operation status. This is validation of the same transformation, not a second provider call or whole-document AI rewrite. After acknowledgement, resume typing; later saves are ordinary manual mutations. If another tab wins, retain the local proposal in conflict recovery, do not mark applied, and allow regeneration from a current selection. Lost acknowledgements retry the same body/mutationId. No acceptance claim/lease is needed in addition to the final atomic save.

Never use whole-document `setContent` for targeted AI edits. Reserve it for initial load and explicit version/remote-state load when dirty edits are resolved. AI regeneration follows the same preview rules but requires a separate whole-lesson confirmation and a base-revision guarded server commit; it snapshots the replaced document.

## Images and chat insertion

Capture cursor plus sequence and revision before upload/generation; insert a previewed asset only if the anchor remains valid, otherwise ask learner to place the cursor again. Upload completion alone never rewrites notes. Chat response insertion uses a locally captured current cursor, sanitized structured blocks, one undo event, and autosave; stored chat messages are unchanged. No rendering unsanitized provider HTML.

Generated-image acceptance saves with `imageOperationId`, atomically marking the ready asset proposal applied when its asset is referenced. Use the same isolated-save barrier as text acceptance; rejection changes no notes. Repositioning a stale image cursor requires explicit user placement, not another image-generation call. Uploaded-image alt/caption are document-node attributes; upload alt is an echoed UI convenience, not a second database copy.

## Version history

Every successful content mutation snapshots the prior revision and its referenced assets transactionally. The current revision is returned alongside immutable history entries; GET current revision can act as a history entry without duplicate storage. Version metadata: revision, timestamp, source (manual/AI/restore/regenerate), optional operation ID, content hash, schema version. Restore validates schema/migrates if needed, snapshots current state, writes restored JSON as revision N+1, and records source version. No automatic history pruning in MVP; surface disk growth and add explicit retention later. Asset garbage collection must honor historical references.

## Required verification

Unit: untouched blocks/marks remain canonically equivalent across targeted edits; one undo reverses acceptance; positions use ProseMirror UTF-16 semantics with emoji; empty/cross-block selections; block split/join/copy IDs; all supported nodes round-trip. Integration: sequential saves, lost responses, CAS conflict, transaction rollback, snapshots/assets, acceptance/rejection race, server/client fragment-transform parity and rejection of out-of-range changes. Playwright: type during save, switch route during save, fail DB/save, two-tab conflict, edit while AI is pending, reject, restore, reload, chat/image insertion. Include browser crash recovery draft tests without claiming crash-proof persistence.

Reference: [Tiptap document/transaction concepts](https://tiptap.dev/docs/editor/core-concepts/introduction), [content commands](https://tiptap.dev/docs/editor/api/commands/content), and [UniqueID](https://tiptap.dev/docs/editor/extensions/functionality/uniqueid). Tiptap documents JSON retrieval and whole-document replacement; the guarded editing protocol above is a project design decision.
