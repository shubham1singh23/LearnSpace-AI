# Milestone 4 — AI-powered selection editing

Roadmap scope: **tasks 17–21**, implemented in the approved seven-phase order. This checkpoint extends the existing editor, autosave queue, lesson transactions and durable operation service. It does not start Milestone 5, add infrastructure, install dependencies, or change corrected architecture documents.

Authoritative references: `IMPLEMENTATION_PLAN.md` (Milestone 4 gate), `EDITOR_DESIGN.md` (Capturing a selection; Preview, acceptance, and stale handling), `API.md` (Selection edit schema; Errors, limits, and idempotency), `AI_DESIGN.md` (structured contracts, prompt boundaries, context and failure handling), and `AGENTS.md`.

## Implemented behavior

Learners can select supported saved text, choose an action, generate a durable proposal, review the original and proposed text, reject or copy it, or explicitly confirm acceptance. Generation never modifies the live or saved lesson. Acceptance applies exact shared ProseMirror replacement/insertion steps and immediately saves through the existing exclusive autosave queue. It does not call whole-document `setContent` or reload the editor to apply a targeted edit.

| Action | Mode | Constrained result |
|---|---|---|
| Explain | Insert after selected block | Explanatory paragraphs |
| Simplify | Replace selection | Simpler text |
| Expand | Replace selection | Expanded text |
| Rewrite | Replace selection | Reworded text |
| Example | Insert after selected block | One labelled example block |
| Analogy | Insert after selected block | One labelled analogy block |
| Custom | Explicit replacement or insertion | Instruction required; same bounded vocabulary |

Manual creation/editing and Milestone 3 regeneration remain available. Creating courses, opening topics, loading notes and completing generation do not automatically accept selection edits or generate additional lessons.

## Selection and identity

- Eligible ranges are exact nonempty text ranges in paragraphs/headings, including safe nested ranges, and complete contiguous eligible sibling blocks. Complete single-block node selections are supported.
- Cursor-only, whitespace-only, partial cross-block ranges, cross-parent/list-item/table-cell selections, code-block transformations, images, math atoms and structural/unsupported selections are rejected. Selecting text beside an atom is permitted when the atom is outside the actual range.
- Positions use ProseMirror UTF-16 units. Boundaries splitting a surrogate pair are rejected. No grapheme rebasing or fuzzy matching is performed.
- Capture occurs after a successful queue flush. Browser selection is read before focus moves into the capture barrier; a transient editor-owned range is tied to its document transaction sequence. A document change clears it. This is not proposal rebasing.
- Trusted selection descriptors include revision, document hash, exact input/replacement boundaries, block IDs and canonical shells, slice/open-boundary hash, insertion anchor/context hash, and a full target fingerprint. The client additionally retains editor instance identity, editor document transaction sequence and autosave local sequence.
- Selection movement does not retarget a proposal. Any document-changing transaction invalidates it, including formatting, edits outside the selection, undo/redo, image insertion, and changes returning to identical text. Remounting does not recreate acceptance authority.
- Duplicate block-ID repair retains the mapped original owner when a copy is inserted before it. Copies receive fresh IDs; move, split, join and undo/redo behavior have regression coverage. Position mapping is used for ID maintenance, not AI proposal rebasing.

Initial limits are 12,000 selected UTF-16 units, 100 selected blocks, 4,000 instruction characters, 16,000 total output text units, 32 KiB model output, and at most 32 inserted blocks. Existing canonical document size/depth/node limits still apply.

## Fragment compilation and preservation

Models return only `inline` text, one text item per selected block (`block_texts`), or bounded `insert_blocks` with paragraph/example/analogy types. They cannot supply document roots, marks, node attributes, IDs, URLs as link attributes, assets, editor positions, executable nodes or filesystem paths. Unknown properties and malformed Unicode/output fail validation.

The server compiler assigns insertion IDs and constructs allowed canonical nodes. Replacement retains the original block types, IDs and learning-role/group metadata. Text outside the range and unrelated blocks retain their content and marks. Replacement inherits marks common to the selected runs; mixed formatting is not guessed. Preview discloses when only common marks can be retained. Model text is rendered as text, including malicious-looking markup.

The shared pure transformation recaptures and verifies the complete target, checks exact fragment fit, preserves replacement shells, rejects no-change proposals and validates the final full canonical document. The live editor rebinds its serialized steps to the live schema and uses the same transformation as the server. Acceptance creates one isolated ProseMirror history event, with boundaries before and after it.

Prompts use the existing untrusted-context teaching policy and one bounded structural repair. Saved context includes bounded selected-block/adjacent text, course preferences/goal/objectives and up to three saved prerequisite excerpts, with source revisions and omission disclosure. Images/math are not sent as visual inputs. Validation proves structure and scope, not educational truth.

## API, operations and transaction semantics

New endpoint: `POST /api/v1/lessons/:id/edits`, with a UUID `Idempotency-Key` and the approved strict `EditRequest`: base revision, action/mode, optional instruction, exact target (`from`, `to`, start/end block IDs, slice hash), and optional terminal-operation retry ID. It returns the existing 202 operation handle/status/events URL. Changed input under the same key conflicts; retrying a lost start acknowledgement does not invoke the model twice.

Shared contracts add selection/action/model-fragment/prepared-proposal schemas and the `edit` operation kind/result. Existing operation status, SSE/polling, cancellation/rejection and bounded course discovery routes now include edits. No duplicate recovery/status/acceptance endpoint was introduced.

Durable generation reuses configuration resolution, credential memory, capability registry, admission bounds, usage records, execution ownership, heartbeat, cancellation, deadlines and reconciliation. Ready publication is fenced against changed course/lesson context and expired ownership. Cancellation/expiry/late results never write notes. Recovered unaccepted proposals are **view/copy/reject only** in a new editor instance.

Acceptance uses the existing `PUT /api/v1/lessons/:id` body with `aiOperationId`, base revision, immutable mutation ID, schema version and candidate document. Server lock order is **course → lesson → operation**. Exact receipt replay precedes current revision/operation checks. A new acceptance then:

1. Checks lesson CAS and operation ownership/type/status/expiry/base context.
2. Verifies stored target and prepared target agree, then reconstructs the exact transformation from current saved notes.
3. Rejects client content that differs from server reconstruction; validates the full document and course-owned ready assets.
4. Snapshots the previous document/provenance and asset references, updates the lesson as `ai_edit` at the next revision, replaces current references and inserts the mutation receipt.
5. Marks the operation applied in the **same transaction**. Any failure rolls everything back.

Cancelled, expired, foreign, stale, malformed and out-of-range requests cannot commit. Concurrent cancellation/acceptance serializes to one outcome. The same mutation/body replays its original receipt after a lost response, even after later manual revisions; a changed body under that ID conflicts.

## Isolated save, recovery and navigation

Acceptance is journal-first: the exact immutable PUT body and candidate JSON must successfully commit to IndexedDB **before** editor dispatch or HTTP. Storage failure leaves the editor unchanged and sends nothing. A local transaction filter blocks other document changes during the barrier; no extra server acceptance-claim lease was added.

The existing queue owns the immediate save and retry. The acceptance transaction's update is recognized without entering ordinary manual coalescing. New typing cannot be folded into that mutation. Generic overwrite/discard cannot downgrade or erase an unresolved AI acceptance. Journal creation itself counts as dirty for navigation protection.

While acknowledgement is unknown, editing, unsafe route/destructive actions and unload are guarded. Explicit retry reuses the original request. Refresh offers explicit recovery/resume and then replay of that exact confirmed acceptance; it never invents a fresh mutation ID. A definitive server rejection retains local JSON for comparison/download and permits explicit discard/load of saved notes. It does not offer a manual overwrite of the rejected proposal. Browser recovery storage remains best effort except for the mandatory pre-dispatch acceptance journal.

Version history/restoration and current/historical asset references reuse existing services. Restoration creates another revision. Browser tests fetch real uploaded image bytes after AI editing and restoration.

## Files changed

| Area | New or modified files |
|---|---|
| Shared contracts/selection/transform | `packages/shared/src/edit-contracts.ts`, `selection.ts`, `edit-transform.ts`, `selection.test.ts`, `ai-contracts.ts`, `index.ts` |
| Prompt and compiler | `packages/ai/src/edit-pipeline.ts`, `edit-pipeline.test.ts`, `index.ts` |
| Backend integration | `apps/api/src/ai/edit-service.ts`, `operations.ts`, `router.ts`; `apps/api/src/workspace/lesson-service.ts` |
| Editor/workflow | `apps/web/src/editor/SelectionEditing.tsx`, `EditPreview.tsx`, `accept-edit.ts`, `selection-plugin.ts`, `extensions.ts`, `NotesEditor.tsx`, `PersistentNotes.tsx`, `editor.test.ts`; `apps/web/src/OperationStatus.tsx` |
| Existing persistence extensions | `apps/web/src/persistence/autosave.ts`, `autosave.test.ts`, `recovery.ts` |
| Verification fixtures | `tests/integration/selection-edits.test.ts`, `tests/e2e/selection-editing.spec.ts`, `tests/support/server.ts` |
| Completion evidence | `docs/MILESTONE_4.md` |

No package/lockfile, provider adapter, architecture document, existing migration or Prisma model change was required. Existing CI already discovers these tests and runs PostgreSQL/browser suites sequentially; no CI configuration change was necessary.

## Database and data preservation

**No migration created or modified.** Existing `AiOperation`, `Lesson`, `LessonMutation`, `DocumentVersion`, `LessonAsset` and `VersionAsset` maintain the required invariants with the existing service transactions and constraints. No developer/learner database reset, seed overwrite or destructive migration was run. Tests use only the isolated `learnspace_test_m2` database. Receipt-failure tests temporarily add a test-only rejection constraint and remove it in `finally`; this is fault injection, not a shipped migration.

The working tree was clean at the start. Corrected architecture documents and `MILESTONE_1.md`, `MILESTONE_2.md`, `MILESTONE_3.md` remain unchanged. No commit, push or deployment was performed.

Two identified course fixtures left by failed browser setup/timeouts were removed only from the isolated test database. Its original seeded content remains: 1 course, 4 topics, 0 lessons. The test PostgreSQL cluster was stopped after verification, restoring its initial stopped state.

## Phase gates and actual verification

| Phase | Gate evidence |
|---|---|
| 1 — selection contracts/identity | Targeted selection/editor tests passed after normalizing known ProseMirror null/default serialization; UTF-16, nesting, block capture, copy-before-original and transaction sequence covered |
| 2 — fragment/prompts/transform | Targeted 14-test compiler/editor gate passed; all seven actions, preservation, parity and one undo event; live-schema step rebinding corrected before advancing |
| 3 — durable generation | Initial PostgreSQL gate: 3 passed; no content writes, idempotency, invalid output, discovery, cancellation, expiry and changed saved context |
| 4 — toolbar/preview/reject | Chromium preview/rejection/refresh discovery gate: 1 passed; mounted-editor registration and focus handling corrected |
| 5 — isolated barrier | Targeted editor/autosave gate: 15 passed; mandatory journal, exact retry/recovery, exclusion of typing and one undo/redo event; typecheck/lint passed |
| 6 — atomic acceptance | Initial PostgreSQL acceptance gate: 7 passed; integrated Chromium gate: 2 passed. Acceptance was enabled only after client barrier and server reconstruction/transaction gates passed |
| 7 — regression/evidence | Full verification and focused final checks below |

Environment: Windows PowerShell, Node **24.19.0**, npm **11.17.0**, real isolated PostgreSQL and installed Playwright Chromium. All mandatory model calls use deterministic fake providers; no personal keys or live provider calls were used.

| Command/check | Actual result |
|---|---|
| `npm.cmd run check` | Passed: Prisma validation, lint, workspace/tool typechecks, unit tests and all production builds |
| `npm.cmd run test:unit` | **84 passed**, 15 files; includes existing Milestone 1–3 and four-adapter deterministic tests |
| `npm.cmd run test:integration` with `TEST_DATABASE_URL` | **47 passed**, 8 files; real PostgreSQL, including process restart and migration/transaction regressions |
| `npm.cmd run test:e2e` with `TEST_DATABASE_URL` | **27 passed**, Chromium, 1 worker, production web and dedicated fake-provider API |
| `npm.cmd run build -w @learnspace/web` after final selection handling | Passed; latest editor code typechecked and bundled |
| `npm.cmd run lint`, `npx.cmd tsc --noEmit -p tsconfig.tools.json`, web typecheck | Passed after final UI changes; final context follow-up results recorded below |
| `npm.cmd run db:status` with isolated `DATABASE_URL` | Passed: 2 existing migrations, schema up to date |
| `git -c core.safecrlf=false diff --check` | Passed |
| Browser credential-sentinel scan | `browser-fixture-secret` absent from production web output |
| Protected-document/schema/migration/package diff | No changes |
| Live providers, remote CI, other browsers | Not run; no live compatibility or remote success claimed |

Final context follow-up verification: `npm.cmd run test:integration -- tests/integration/selection-edits.test.ts` passed **9/9**, including surrounding-text and image-omission assertions; `npm.cmd run test:e2e -- tests/e2e/selection-editing.spec.ts` then passed **13/13**. Backend/test-server compilation, lint and tool typechecks also passed. These followed the full regression runs; PostgreSQL and browser suites never overlapped.

Earlier failing gates were fixed and rerun, not waived. Failures included invalid new test fixtures (unsupported learning metadata, list-item shape and mutually exclusive code marks), a TypeScript test annotation, live-schema step identity, React ref rendering, mounted editor registration and native selection/focus timing. Browser exact-range fixtures now use DOM ranges rather than timing-sensitive native word selection; the real selection capture and editor transaction paths remain exercised. Preview/reject/recovery passed three repeated focused runs, and the cursor/cancellation scenario passed five focused repetitions before the final full browser pass. No environment-blocked gate was waived.

## Limitations and remaining risks

- Selection support and fragment vocabulary deliberately remain conservative. Cursor actions, arbitrary tables/lists/atoms/code transformations, mixed-mark reconstruction, rebasing and fuzzy matching are deferred. Strict staleness can require a new generation even when the selected text appears unchanged.
- Preview is functional original/proposed text with formatting disclosure, not a polished visual diff. Browser tests cover Chromium; Firefox/WebKit and remote CI were not executed here.
- Refresh/remount loses unaccepted proposal acceptance authority and ordinary in-memory undo history. Copy/reject/new generation are available; only an already-confirmed immutable acceptance may replay.
- Fake providers verify contracts and workflow behavior, not live model capability, credentials, factual accuracy, educational quality or billing cancellation. Existing provider endpoint, credential, tracing, timeout and request/output safeguards remain in place. Live tests remain explicitly opt-in.
- IndexedDB eviction, storage failure and OS/browser crashes still cannot guarantee every keystroke. Mandatory acceptance journaling prevents unjournaled accepted mutations, but durable storage can still be externally cleared. Duplicated-tab recovery-scope limitations inherited from Milestone 2 remain.
- The local application remains a single API process with in-memory credentials and interaction-driven operation reconciliation. No background worker or operation/asset garbage collector was added. Provider abort/billing is best effort; database fences protect persistence.
- Existing production build warnings about Zod annotations and frontend chunk size remain nonfatal. Bundle splitting/UI polish are deferred.

## Next bounded milestone

Recommend Milestone 5 **tasks 22–26 only**, after separate approval: isolated persisted chat turns with status/SSE recovery, bounded revision-aware saved-note context, explicitly accepted scoped insertion, preferences/prerequisite/progress controls, and objectives/reflection/recall workflows. Reuse the operation, context, selection transformation and persistence safeguards; do not weaken strict staleness or silently merge notes. Image generation and exports remain later roadmap scope.

Recommended optional checkpoint after owner review: `feat: previewed selection AI edits`. No commit or push was made. Stop at Milestone 4.
