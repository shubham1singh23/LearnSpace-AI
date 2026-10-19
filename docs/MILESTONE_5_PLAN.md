# Milestone 5 implementation plan — contextual tutoring and retention

Status: **proposed for review, not implementation authorization**. Scope: roadmap tasks **22–26**. Prepared from repository inspection on 2026-10-19. No application code, dependencies, migrations, approved architecture documents or existing user changes were modified for this plan. No application tests were run during this planning task.

## 1. Objective and exact scope

Make an existing lesson a safe tutoring and learning workspace: discuss its saved edited notes, recover its independent conversation, explicitly insert a completed answer, adjust course teaching preferences, choose prerequisite study/skip, record leaf completion, and practice reflection/recall without implicitly changing notes.

| Task | Required delivery | Existing behavior to retain |
|---|---|---|
| 22 | Persist lesson-scoped chat turns; durable ownership, cancellation, retry, SSE status and polling/reconnect recovery | Four provider adapters/configuration, admission limits, execution leases, safe errors, separate notes |
| 23 | Bounded, revision-aware saved-note/path/prerequisite/recent-turn context with omission disclosure | No generated-draft context, retrieval service, embeddings or automatic whole-course loading |
| 24 | Explicit completed-response insertion at a newly captured editor cursor, safe transformation, one undo event and existing persistence | No automatic insert, provisional insert, selection replacement, silent merge or whole-document `setContent` |
| 25 | Course preferences UI; preserve workspace defaults; improve existing prerequisite controls; leaf progress and derived totals | Existing metadata/tree CAS, wrap identity, study/skip endpoints and reversible choices |
| 26 | Objectives display, guided/read mode, reflection pauses, paired recall reveal, transient practice answers and explicit answer insertion | Full canonical content and marks remain present; edit mode reveals everything; no grades/mastery algorithm |

Dependencies are Milestones 1–4, not new infrastructure. Defer tasks 27 onward: generated images, asset GC, exports, backup/import and release-wide polish. Also exclude authentication, agents, LangGraph, vector databases, brokers, Redis, Kafka, web retrieval, scheduling/spaced repetition and encrypted credential vaults.

### Authority and interpretation

Read and reconcile:

- [AGENTS.md](../AGENTS.md): package boundaries, isolated saves, strict staleness, secrets and verification.
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): “Exact task order and daily gates”, Milestone 5; P07/P08 traceability.
- [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md), [ARCHITECTURE.md](ARCHITECTURE.md), [ADR 0001](adr/0001-mvp-architecture.md): modular monolith, canonical JSONB, operation lifecycle and rejected shortcuts.
- [API.md](API.md): chat/progress routes, chat retry identity, SSE fallback, ordinary chat insertion saves.
- [DATABASE.md](DATABASE.md): Chat/Preferences/progress transaction recipes, active-scope uniqueness, lifetime mutation receipts.
- [AI_DESIGN.md](AI_DESIGN.md): bounded context, latest six complete turns, saved revisions, untrusted context, provider capability conservatism.
- [EDITOR_DESIGN.md](EDITOR_DESIGN.md): learning-role metadata, transient scratch answers, read/edit distinction, cursor insertion and persistence barriers.
- [PRD.md](PRD.md) P07/P08, [RISKS.md](RISKS.md), and [EXPORT_DESIGN.md](EXPORT_DESIGN.md): retention requirements, failure priorities, preserve all content for later exports without implementing them now.
- [MILESTONE_1.md](MILESTONE_1.md), [MILESTONE_2.md](MILESTONE_2.md), [MILESTONE_3.md](MILESTONE_3.md), [MILESTONE_4.md](MILESTONE_4.md): completed behavior and actual limitations.

Several design documents still say “not implemented” and early milestone reports say the next milestone was not authorized. These are historical status statements, not grounds to remove the verified implementation. Corrected behavioral decisions remain authoritative; actual modules and later completion records establish what exists. Do not rewrite approved documents merely to modernize their introductory wording.

## 2. Existing implementation and precise reuse

| Existing files/models | Reuse | Missing work / boundary |
|---|---|---|
| `apps/api/src/ai/operations.ts` | Scope/key/hash replay, global admission, captured input, owner token, 30-second lease/5-second heartbeat, deadline, cancellation, discovery | Kind allowlists omit `chat`; generic finalization produces `ready`; no chat-user reservation or atomic message completion/terminal reconciliation |
| `apps/api/src/ai/router.ts`; `apps/web/src/OperationStatus.tsx` | Existing operation GET/events/cancel/discovery, reset/status protocol and polling | No message/chat-turn routes, no chat result reference, UI handling for chat completion; current event schema contains status only |
| `apps/api/src/ai/configuration.ts`; `packages/ai/src/adapters.ts`, `transport.ts`, `registry.ts` | All four LangChain adapters, secret resolution, guarded endpoints, bounded calls, conservative capability snapshots | Adapter is JSON `generate` only; `disableStreaming: true`; registry streaming is `unknown`; fetch guard buffers the response. Do not claim token streaming exists |
| `apps/api/src/ai/context.ts`, `edit-service.ts` | Existing saved-note/prerequisite capture and manifests; existing generation behavior remains working | No chat history/lexical selection; extraction policies are duplicated; existing byte clipping is unsuitable for a new Unicode/block-safe chat selector |
| `packages/shared/src/ai-contracts.ts` | Model snapshots, manifests (current + three prerequisites), DTO/result/event validation | No chat kind, message DTO, chat result, retry/anchor/progress contracts |
| `prisma/schema.prisma`: `ChatMessage`, `AiOperation`, `ModelUsage`, `LearningProgress` | All required storage tables already exist | Service invariants and APIs must be implemented; one progress/tree invariant is incomplete—see §8 |
| Initial migration | `(lessonId,sequence)`, global `(turnId,role)` uniqueness; active `chat:<lessonId>` partial uniqueness; chat/status/progress checks; cascading owners | These are scaffolding, not proof of a working chat/progress feature |
| `apps/api/src/workspace/lesson-service.ts` | Ordinary PUT, CAS, receipt-first replay, snapshots/provenance/assets and restore | `aiOperationId` is specifically a ready **edit** operation. Completed chat must not be submitted through it |
| `apps/web/src/persistence/autosave.ts`, `recovery.ts`, `navigation.ts`; `editor/PersistentNotes.tsx` | Sequential queue, immutable request replay, IDB, navigation freeze, mandatory acceptance journal and exclusive save behavior | Exclusive pending detection currently relies on `body.aiOperationId`; explicit chat/scratch insertion uses a manual PUT and needs a typed local isolation marker |
| `editor/accept-edit.ts`, `selection-plugin.ts`, `extensions.ts`; shared `selection.ts`, `edit-transform.ts` | Transaction sequence, instance/range fingerprints, transaction filter, schema step rebinding, history boundaries, ID maintenance | Existing transform deliberately rejects cursor-only selections. Add a separate small cursor insertion helper; do not relax AI selection rules |
| `apps/api/src/workspace/router.ts`, `tree-service.ts` | Course preference/objective PATCH, prerequisite choices, course lock, tree revisions, identity-preserving wrap | Progress routes/totals absent; add/move guard only lesson owners, not progress-only owners |
| `apps/web/src/workspace.tsx`, `ModelSettings.tsx` | Course/topic routing, note handles, workspace defaults and basic prerequisite/objective controls | No chat panel, progress display, course preference editor, read/learn mode or scratch/reveal state |
| `packages/ai/src/compiler.ts`; shared `document.ts`, `editor-schema.ts` | Existing reflection and paired recall attrs, all-node schema, fresh IDs, objectives and recall generation | Saved metadata is available but has no learning presentation. No new editor node/schema version is needed |
| Existing tests/configuration | Real PostgreSQL fixtures, deterministic adapter factory, Chromium, exact DOM selection fixtures, restart/race tests, sequential CI | Extend tests; never connect mandatory chat verification to personal providers |

Last recorded Milestone 4 results are 84 unit, 47 PostgreSQL and 27 Chromium tests. These are historical evidence, not results rerun for this plan. The current worktree contains those uncommitted Milestone 4 files; preserve them byte-for-byte during planning and implementation preparation.

## 3. Chat lifecycle, persistence and concurrency

### 3.1 Start and durable identity

Use the documented `POST /lessons/:id/chat-turns` with an immutable UUID `Idempotency-Key` and `clientTurnId`. Browser briefly freezes editing, flushes the existing notes queue, checks validity/recovery/unknown acceptance, captures revision and any selected block IDs, then releases the editor after the start barrier. User-selected block IDs are validated against that saved lesson; no client-supplied selected text, context document, provider credentials or system prompt is accepted.

For a new request, perform admission and reservation in one short transaction:

1. Preserve replay-before-credentials semantics: existing scope/key/body returns the original operation even if notes/configuration later changed.
2. Take the existing admission advisory lock, then course and lesson row locks. Enforce global two-call admission and one active chat turn per lesson. A different active turn returns `CHAT_TURN_ACTIVE`, not an unbounded queue.
3. Require the requested saved revision; read lesson/topic/path/preferences/prerequisites/history consistently under the course lock. Capture input before any external call.
4. Validate global `clientTurnId` ownership. A turn ID from another lesson is rejected without returning its content. Matching text with a new turn ID is a new explicit question, not automatic deduplication.
5. Create the owned operation and user message atomically. A narrow `onReserved` transaction hook in the existing operation service can attach the message after the operation ID exists, before transaction commit/dispatch. Configuration/admission/capture failure rolls back both records.
6. Assign monotonic sequences under the lesson lock. Reserve a logical pair: user at the next even sequence, assistant at user+1. Gaps after unsuccessful turns are valid and never reused for another turn. Do not compute sequence with an unlocked `MAX`.

User `content`, `turnId`, lesson, sequence and captured revision are immutable. Proposed status policy: user row is `pending` during its active attempt, `completed` with a completed assistant, or `failed`/`interrupted`/`cancelled` with that terminal attempt. It remains visible in history in all cases. Do **not** persist provisional assistant text; create the assistant row only on successful completion.

The existing global `(turnId,role)` unique index and per-lesson active-operation index are retained. Detect intended chat conflicts before the index violation so callers receive specific errors rather than the generic transaction constraint error.

### 3.2 Successful completion

Chat is a direct-to-`applied` operation, not a `ready` proposal. After a complete bounded validated answer, lock **course → lesson → operation**, verify owner token, active status, lease and deadline, and confirm the user row still belongs to this attempt. Atomically:

- Insert exactly one completed assistant at its reserved sequence, with the same turn ID and original `contextRevision`.
- Mark the user completed and operation applied, storing a durable reference such as `{type:'applied_chat',lessonId,turnId,messageId,contextRevision}` rather than duplicating the answer in operation JSON.
- Finalize available success-attempt usage in that transaction; see the existing measurement mismatch in §10.

Do not check that notes still equal the captured revision at completion: approved AI design permits a chat answer against labelled older notes. No lesson document, lesson revision, snapshot, asset reference or progress record changes when chat completes. A deleted owner prevents finalization; no row is recreated to resurrect a deleted lesson/course.

### 3.3 Failure, cancellation and restart

Add chat-specific terminal handling to the existing service, not a separate executor:

- Cancellation and success take the same lock order. Cancellation wins only while the operation is active; if completion won, return applied truthfully and preserve the answer.
- Failure/interruption/cancellation updates operation and associated pending user status together; assistant content remains absent. Do not let an older attempt change the user status after a retry became its owner.
- Chat lease reconciliation must process bounded expired batches with locks and rechecks. Merely adding `chat` to the existing bulk `updateMany` leaves pending user rows orphaned and is insufficient.
- Startup/read/discovery reconciliation never restarts model calls. Lost leases, late callbacks, deleted owners and expired deadlines cannot persist an assistant.
- Provider abort and exact billing are best effort. Keep captured secret references only until bounded execution ends. Logs/usage never contain message content, prompts, secrets or raw provider errors.

### 3.4 Retry and lost acknowledgements

Same key/body returns the same operation and never reexecutes a failed call. Explicit retry uses a new key plus `retryOfOperationId`, the same `clientTurnId`, exact message/base revision/selected IDs, and a terminal failed/interrupted/cancelled prior chat operation. Reuse its single user row and sequence; do not append another user message.

Recommended conservative completion of the underspecified retry contract: retry only the latest turn, with no intervening turn, current lesson revision still equal to its base, and an unchanged context fingerprint. Store a nonsecret hash of the bounded prompt context/turn inputs in operation target metadata; compare reconstructed context on retry, excluding provider configuration so an explicitly corrected model configuration can be used. A changed note, prerequisite, course preference/path/objective or included history requires a **new** turn ID and explicit new question. Never reconstruct imaginary old preferences after restart or silently adopt new context under an old turn. Prompt bodies need not be persisted.

A completed turn cannot be retried as generation. A different key for the same active turn may return its matching active operation; a changed body conflicts. New intent after an ambiguous response is never inferred automatically.

Journal an acknowledged Send intent (key/turn ID/immutable request) using the existing IndexedDB utility under a distinct chat-start key before dispatch; no provider secrets. Until its outcome is known, preserve composer text and offer exact retry/copy. If this mandatory request journal fails, retain text and send nothing. Once the operation is known durable, clear that start journal; refresh recovery loads messages and operation discovery. This is a small request journal, not another notes database/queue. Unsent composer text is explicitly unsaved UI state, with a discard warning; never POST just because a topic opens.

## 4. Transport and frontend chat

### Recommended baseline: truthful status-first SSE

All four installed adapters currently disable token streaming, the capability registry reports streaming unknown, and `guardedFetch` buffers response bytes. Reuse JSON `generate` with a narrow internal `{text:string}` answer schema and existing prompt policy; persist its text as ordinary chat content. This needs no new dependency or provider capability claim.

For Milestone 5, recommend existing status SSE + complete durable answer + polling fallback for all four adapters, as allowed by API.md's nonstreaming-provider behavior. Do not simulate token streaming by chopping an already completed answer. This mode requires owner approval in §10 because “streaming” can otherwise be interpreted as raw model deltas.

Transport behavior:

- POST establishes durable work; subscribe to existing `/operations/:id/events` and poll existing GET on disconnect.
- Keep the current status event envelope compatible; `done` is emitted only after the chat transaction commits. Message fetch, not transient display state, establishes completion.
- Reconnect/reset discards any provisional UI, fetches durable operation/messages and never sends a new POST. Deduplicate by message ID/turn ID and monotonic message sequence, not arrival order.
- Retain server heartbeat and detach clients on disconnect. Closing a panel/topic or an SSE connection does not cancel a durable turn. Explicit Cancel does.
- Navigation is permitted while a known durable chat operation runs once notes are safely flushed. Unknown Send and unknown accepted insertion outcomes still need recovery protection.

If raw token streaming is required for this milestone instead, approve that before implementation: add an optional text-stream method to the **same** adapter interface, bounded incremental transport with redirect/origin/byte/deadline/abort checks, deterministic SDK stream fixtures for all four adapters, and verified capability gating. Add a bounded execution-scoped delta buffer (proposed 64 KiB/128 events), monotonic execution-aware event IDs, reset after a gap/restart, output limit (16,000 UTF-16 units/64 KiB), and backpressure/slow-client disconnect. No transcript token persistence or broker. No automatic retry/repair after emitted text; interrupted output is visibly incomplete and never a completed message or insertable answer. Unknown providers retain status fallback. This is an explicit alternative, not silently included work or evidence of existing streaming support.

### UI structure

Add `apps/web/src/chat/ChatPanel.tsx`, `ChatTranscript.tsx`, `ChatComposer.tsx` and a small lesson-keyed query/controller hook. Integrate beside `PersistentNotes` in `apps/web/src/workspace.tsx`; use a collapsible panel/drawer, keyboard focus controls, narrow-screen layout, polite status announcements and cancellation. Reuse `api`, schemas and operation transport; extract a transport hook from `OperationStatus` only as needed, without changing existing generation/edit behavior.

Extend the existing `NotesHandle` with a narrow `prepareChatContext()` callback owned by `PersistentNotes`: it performs the flush/freeze barrier and returns the checked lesson ID, base revision and bounded selected saved block IDs. Keep the editor/queue inside their existing owner rather than constructing another queue in ChatPanel. Compose Workspace navigation checks for notes, unsent composer discard warnings and unknown Send journals; do not treat an active durable turn as unsaved notes or send composer text from a navigation flush.

Initial history loads the latest bounded page, displayed ascending by sequence; “Older messages” fetches before the earliest sequence. New durable completion fetches after the latest seen sequence. Validate cursors against the lesson; no duplicate/omitted boundary messages. Abort/ignore old lesson fetches using lesson ID and request epoch. A late response from lesson A cannot enter lesson B's UI.

Expose loading/retry, empty history, no notes yet, no configured model, pending user/active answer, cancelled/interrupted/failed turn, stale captured-context badge and completed answer states. Message content is text, not unsanitized HTML/Markdown. Display model identity and captured revision via the operation where available. No chat or initial lesson is generated by GET/open/reload. Ungenerated leaves offer the existing manual blank or explicit lesson generation first because chat is lesson-scoped.

## 5. Revision-aware context policy (task 23)

Implement `apps/api/src/ai/chat-context.ts`, reusing extraction primitives from `context.ts` only where behavior matches. Keep existing generation/edit policies stable; do not undertake an unrelated context-framework refactor.

1. Short consistent capture under the course/lesson locks: validate current document/schema; use saved edited JSON at requested revision, never an old generated result, unsaved browser JSON, read-mode projection or scratch answer.
2. Include the current question, bounded course goal/preferences/path/objectives, selected eligible block IDs first, adjacent blocks, useful headings and deterministic lexical matches to the question. Resolve ties by document order/ID. Inspect nested content with bounded traversal; no model-selected DB identifiers.
3. If the full lesson fits, include it; otherwise include whole labelled blocks/paragraphs. Keep code/math expressions intact or omit them with disclosure. Never byte-slice UTF-8 into replacement characters or silently cut a code expression. An oversized required selected block/question yields an actionable budget error rather than lossy “mandatory” context.
4. Include at most three relevant prerequisite excerpts, deterministically ordered, with study/skip/undecided labels. Skipping never deletes/hides the dependency; include a small labelled skipped prerequisite where useful rather than pretending mastery. Missing saved prerequisites are labelled as missing; no automatic generation.
5. Include at most six **complete user+assistant pairs** from this lesson preceding the current turn. Failed/pending/partial attempts are visible in history but excluded from completed conversational context. Never cross lessons or treat prior assistant assertions as verified authority.
6. Respect the installed adapter's conservative budget: `min(12000, contextWindow - reservedOutput - 1024)`, accounting for UTF-8 bytes of the complete serialized system+input (current adapter's conservative token estimate). Existing options default to 2,048 output tokens. Reduce optional context deterministically before invocation; reject if mandatory input cannot fit. Do not call byte counts measured token usage.
7. Preserve existing manifest source semantics (current + at most three prerequisite lessons) and add bounded optional metadata for selected/history message IDs, captured tree revision, algorithm version, omissions/reasons and context hash. These are JSON/contract additions, not new tables. Record only source blocks actually included; no credential handles/raw prompts. Existing old operation manifests remain parseable.

Proposed initial new limits for approval: message input 16,000 UTF-16 units (documented API maximum, still subject to actual input budget); completed answer 16,000 units and 64 KiB UTF-8; selected block IDs at most 100; list pages 1–100/default 50; same global two-call and 120-second operation ceilings. The model output schema disallows invalid Unicode/unknown keys; model text cannot create executable nodes or asset references.

Later note edits, restoration, preferences or prerequisite changes do not invalidate an already running **conversation**; it finishes against its labelled captured context. The next question flushes and captures new saved context. This exception never relaxes Milestone 4 edit-proposal staleness. A stored old answer may be inserted only through a newly captured current cursor with explicit acknowledgement of its older context.

## 6. Explicit chat and scratch-answer insertion (task 24, reused in 26)

The insertion contract differs deliberately from selection AI acceptance. API.md explicitly says chat/upload insertion uses neither operation field. Chat's operation is already applied when its message is persisted. Inserting a stored response must not reapply/reject it or mark chat “ready”.

Recommended bounded insertion policy for approval:

- Only completed assistant messages from the currently open lesson are insertable. Copy remains available for all completed text; partial/pending/failed answers have no insert action.
- Learner chooses “Insert into notes”, moves to Edit mode, flushes notes, places a fresh collapsed cursor in an eligible paragraph/heading (including safe nested text), then previews the insertion. Nonempty selections are rejected to prevent accidental replacement. No fallback to document end or remembered generation-time positions.
- Convert text deterministically into safe Tiptap inline text/hard-break content at that exact cursor; preserve the existing block shell/metadata and all surrounding text/marks. Do not interpret Markdown fences, HTML, links or model-supplied JSON. Long output is rejected before mutation with copy/manual-edit alternatives; no silent truncation. Use existing `textFragment`/canonical schema.
- A small shared `insertion.ts` helper captures lesson/revision, editor identity/local transaction sequence, block ID, UTF-16 offset, document/boundary fingerprints and immutable source message ID/text hash. It computes one exact pure transform. Do not make `captureSelection` accept empty ranges globally.
- Any document-changing transaction after preview invalidates insertion, even outside the anchor or after undo/redo; selection movement alone does not retarget it. Allow an explicit fresh placement/preview of the **same stored answer** after staleness, with no new model call. Refresh discards unaccepted anchors; new placement is required.
- Explicit confirmation enters the existing transaction filter/freeze and mandatory journal-first exclusive queue. Dispatch one schema-rebound transaction with isolated history boundaries, then immediate ordinary `PUT /lessons/:id` with base revision/mutation ID and no operation fields. No reload/`setContent` acceptance pattern.

Extend the existing queue with a narrow common isolated-save helper; retain `acceptEdit` as the existing AI-edit wrapper. Add optional typed recovery metadata such as `isolation:{kind:'chat_insert'|'recall_insert',sourceId?,sourceHash}` so an isolated **manual** body remains protected after refresh. Do not infer isolation solely from `aiOperationId`. Existing AI journals and ordinary drafts must parse unchanged. Same IDB store/transaction utility and ordinary SaveLesson wire schema; no second editor queue, generic command bus or new notes persistence service.

Journal immutable body/metadata before dispatch, pause typing until acknowledged, prohibit generic overwrite/downgrade while unknown, replay exact mutation/body after lost response/refresh, and preserve JSON for comparison/download on conflict. The standard server save still performs document/asset validation, CAS, prior snapshot and receipt insertion atomically. The stored chat message remains unchanged; repeated insertion requires another deliberate preview/confirmation, not operation replay.

**Server guarantee:** ordinary chat insertion is a learner-authored save with `manual` provenance. It does not certify a message-source anchor server-side. Milestone 4 AI edits retain independent server reconstruction. Requiring server proof of chat-source/anchor or `chat_insert` provenance would change the approved SaveLesson contract/source allowlist and needs separate approval; do not disguise that change by abusing `aiOperationId`.

Scratch recall answer insertion reuses this same path with an immutable local answer snapshot, no message/model call, and no replacement of the stored model answer. Scratch text is never sent to a provider implicitly.

## 7. Preferences, progress and learning presentation

### Preferences and prerequisites

- Reuse `preferencesSchema`, workspace GET/PATCH settings and `ModelSettings` defaults. Defaults are copied only on new course creation; changing them never rewrites existing courses.
- Add a course-specific preferences form using existing `PATCH /courses/:id` + `baseTreeRevision`. Include all depth/style/examples/analogies/reflection/pace/background fields. Preserve drafts on tree-revision conflict and reload metadata separately, never the live editor.
- Preference/objective changes affect future model context and read presentation; do not regenerate or rewrite saved lesson prose. Distinguish current topic objectives from authored objective text already in notes.
- Existing prerequisite choice PATCH is reused, not duplicated. Keep skipped edges visible, reversible and navigable to their topic; a visit does not generate notes. Serialize local choices/disable overlapping writes, refresh returned tree revision, retain basic last-committed scalar semantics. Course metadata changes can stale existing AI edits server-side; chat may finish against its captured context.

### Progress

Add a small `ProgressService` and documented GET/PATCH routes. Any leaf, including one without a lesson, may be explicitly marked in progress/completed; this follows the current leaf-only specification rather than inventing lesson-generation prerequisites. Opening, reading, revealing, chatting or generating never auto-completes a topic.

Take the course lock before checking leaf identity/upserting status so tree mutations serialize. Missing record means not_started. Set completedAt on transition into completed; repeated completed writes preserve it; other statuses clear it, respecting the existing SQL CHECK. Proposed scalar concurrency policy is last committed explicit status; on a lost acknowledgement read current state before offering explicit reapply, rather than repeatedly sending old intent over another tab. No new progress revision/CAS column is proposed.

Compute course and per-container counts in one bounded consistent read from actual leaves (children determine leafhood, not `kind` or lesson existence). Include ungenerated/skipped leaves in the denominator. Empty course has 0/0 with an empty label, not division by zero. Aggregate bottom-up with an iterative traversal of at most 2,000 topics, not one query per ancestor. Containers are derived and cannot be marked completed. Return a bounded complete course progress DTO; update tree/course indicators without replacing editor state.

Prevent add/move from turning a progress-owning leaf into a container; offer explicit Wrap. Wrap retains original topic/lesson/chat/progress identity and gives the new container derived totals. See the concrete SQL guard gap and conditional migration in §8. Never repair this by deleting a progress row.

### Objectives, read/learn mode, reflection and recall

Add `LearningPanel`/`ReadModeControls` and a read-only projection/decorations extension alongside the current editor, with `PersistentNotes` owning mode transitions and queue barriers. Enter reading after flush; disable editor mutation controls while reading. Returning to editing exposes every block without changing canonical JSON or remounting away unsaved state/history.

Proposed guided behavior for approval: top-level section headings establish sequential reading sections; documents without suitable headings have one section. Guided pace uses Continue/Previous; self-paced displays all sections. Independently, `reflectionPauses=true` inserts a temporary pause at reflection-labelled blocks, continued explicitly. Hiding is a presentation decoration, never a document transaction/deletion/save. Provide “Show all” and always reveal everything for editing, copy/recovery and future export visitors. Reveal changes must not increment the document sequence or stale an AI proposal.

Pair recall questions/answers by existing `learningGroupId`, not proximity/text matching. Reveal only a valid uniquely paired answer after explicit action. Missing/duplicate/misordered metadata gets a clear fallback displaying content safely; never hide an unpaired block indefinitely or silently fix JSON. Preserve nested content and existing learning attrs through save/restore.

Scratch answers and reveal state are transient lesson-session UI state, labelled “Practice only — not saved”. Warn before discarding a nonempty scratch answer; do not classify it as canonical unsaved notes or silently append it. Explicit “Insert my answer” uses §6. No graded attempts table, model grading, automatic completion or mastery score.

Manual/legacy notes without learning metadata remain fully readable/editable and show an honest empty practice state. Do not auto-generate missing objectives/questions on open or infer learning roles from headings. New authoring/tagging workflows are not required to make existing generated metadata usable.

## 8. Backend APIs, contracts and database assessment

All routes are relative to `/api/v1`, use existing local Origin/Host/JSON protections and shared strict Zod schemas. Add no credentials to lesson/chat endpoints.

| Route | Planned request/result | Transaction/idempotency |
|---|---|---|
| GET `/lessons/:id/messages` | `limit`, optional owned cursor + exclusive direction (`before` default-history or `after` refresh); ordered message DTOs, page cursor(s), active chat operation ID | Bounded stable sequence ordering, no provider call; validate cursor lesson ownership |
| POST `/lessons/:id/chat-turns` | `{baseRevision,message,clientTurnId,selectedBlockIds?,retryOfOperationId?}` + UUID key → existing 202 operation handle | User + operation reservation atomic; exact key/body replay; single active lesson turn |
| GET `/operations/:id`, events, course discovery; POST cancel | Reuse existing routes; add chat kind/result/terminal reconciliation | No new status/recovery/cancel service or acceptance route |
| PUT `/lessons/:id` | Existing SaveLesson; chat/scratch insertion omit both operation fields | Existing manual CAS, snapshots/assets and lifetime receipt replay |
| PATCH `/topics/:id/progress` | `{status:'not_started'|'in_progress'|'completed'}` → `{topicId,status,completedAt,updatedAt}` | Course lock, leaf check, idempotent same-state transition; scalar policy above |
| GET `/courses/:id/progress` | `{treeRevision,completedLeaves,totalLeaves,topics:[leaf status or container counts]}` | One bounded consistent course view; no writable container status |
| Existing settings/course/topic/prerequisite routes | Reuse current schemas and revision semantics | No preference/progress writes to lesson JSON |

Message DTO: `{id,lessonId,role,content,sequence,turnId,operationId,status,contextRevision,createdAt}`; assistant completion requires a valid positive captured revision. Unsuccessful turns expose sanitized status/code through operation metadata, not provider raw errors. Pagination additions are proposed contract details because the design only specifies cursor/limit; define them in phase 1 before UI implementation.

Add `packages/shared/src/chat-contracts.ts`, `learning-contracts.ts`, `insertion.ts` (likely names); extend existing operation unions/events/manifests compatibly. Use separate wire and private execution candidate types so an uncommitted answer cannot masquerade as a durable result. Add narrow errors including `CHAT_TURN_ACTIVE`, `TURN_ALREADY_COMPLETED`, `TURN_CONTEXT_CHANGED`, `INVALID_RETRY`, `REVISION_CONFLICT`, `INVALID_CURSOR`, `CONTEXT_BUDGET_EXCEEDED`, `NOT_A_LEAF`, while retaining existing envelopes/status conventions. Invalid upstream output stays failed/502-style safe failure, not completed text. Explicit provider refusal signals must become typed failures; do not claim a semantic detector can recognize every natural-language refusal. Map supported signals without exposing raw payloads or adding a classification model.

### Migration assessment

No new model/table/column is needed for chat, context metadata, learning UI, preferences or ordinary insertion. Keep both existing migrations unchanged. New optional JSON contract metadata and local IDB journal fields are not PostgreSQL schema changes.

One **concrete missing leaf invariant** is visible in source:

1. `progress_leaf_guard` in `20261018000100_initial/migration.sql` rejects progress insertion on an existing container.
2. `validate_topic_tree()` rejects creating/moving a child under a **lesson** owner only; `TreeService.add/move` likewise check lessons only.
3. Therefore a progress-only leaf can acquire a child later and retain explicit progress on a container, contrary to DATABASE.md. This is a source-derived counterexample, not a PostgreSQL test executed during planning.

Recommend first adding a failing real-PostgreSQL counterexample test during approved implementation, then (with owner approval) one small **forward SQL trigger migration** extending the existing parent guard to progress owners, plus matching add/move service guards. Do not add a replacement progress table, edit migration history, require generated notes just to avoid the gap, or silently delete progress. Preflight existing invalid container-progress rows; if present, stop for an explicit preservation/repair decision. No automatic data rewrite. Test both empty deployment and upgrade with existing notes/messages/assets/progress, verify repeated deploy and rollback behavior of failed writes; update `apps/api/src/readiness.ts`'s required migration inventory if one is approved.

If the owner chooses an API-only guarantee instead, document it explicitly and maintain guards for all supported writers; do not claim the existing SQL prevents the counterexample. The recommended plan is the minimal forward trigger fix.

## 9. Dependency-ordered implementation phases and gates

Implement one independently testable task at a time. Preserve roadmap order: task 22 before the full task 23 selector, then 24, 25, 26. Contracts/context prerequisites can be designed first without exposing unfinished chat. Keep new public chat UI disabled until persistence/context gates pass. Stop at a failed gate; if a required gate is environment-blocked, report it and obtain approval before advancing.

### Phase 1 — contracts, lifecycle and invariant fixtures

**Objective/features:** settle §10 decisions; implement strict message/start/result/pagination/context/progress/local insertion contracts and bounded fixtures. Specify sequence pairs, user status ownership, retry fingerprint, completion atomicity and terminal transitions. Specify the progress-only-leaf counterexample and obtain an in-principle fix decision; execute its failing test and fix during phase 6, in roadmap order.

**Reuse/files:** shared base/AI/workspace/document schemas; `prisma/schema.prisma` and initial SQL (inspect, never rewrite); new `chat-contracts.ts`, `learning-contracts.ts`, `insertion.ts` contract portion; corresponding unit tests and `tests/integration/chat.test.ts`/`learning.test.ts` fixtures. No public UI/provider calls or database changes in this phase. The conditional progress migration belongs to phase 6; its policy must be settled before that dependent work.

**Steps:** contracts → valid/invalid/retry/ownership fixtures → compatibility with old operation results/IDB drafts → existing PostgreSQL chat uniqueness/ownership checks → documented progress counterexample and deferred phase-6 fix gate. Do not introduce unused schema features.

**Verification:** unit tests for limits/Unicode/unknown fields/pagination/compatibility; PostgreSQL active chat, global turn ownership and sequence constraint tests; specify progress guard/upgrade fixtures for phase 6; no feature E2E yet, run existing shell/manual smoke if shared contracts change. Typecheck/Prisma/lint.

**Acceptance gate:** required contract decisions resolved; old contracts parse; no new fields leak secrets; chat ownership/uniqueness tests pass, and the progress invariant decision is recorded for phase 6. Do not introduce a deliberately failing progress test into an earlier phase gate. Risks: ambiguous streaming/insertion semantics and latent invalid progress rows. Dependencies: explicit implementation/migration approval; no later phase may hide a failed invariant test.

### Phase 2 — durable lesson chat turns (task 22)

**Objective/features:** persisted user reservation before model invocation, single active turn, exact retries, bounded complete text answer and atomic assistant/applied completion; cancellation/interruption/restart recovery. Use the existing saved-revision context as a minimum baseline; comprehensive selection comes in phase 4.

**Reuse/files:** `OperationService`, configuration/adapters, transaction helpers, `ModelUsage`; new `apps/api/src/ai/chat-service.ts`, `packages/ai/src/chat-pipeline.ts`; modify `operations.ts`, `ai/router.ts`, AI/shared exports and deterministic factory. Add narrow reservation/finalization/terminal callbacks only, no executor framework.

**Steps:** replay/preconditions → atomic reserve/user attach → bounded private answer candidate → owned completion + usage → chat-specific cancel/failure/reconcile → durable result references. Keep no long DB transaction around a provider call. No note/progress writes. API details are §8; reuse existing tables.

**Verification:** unit tests for answer validation/prompts/limits; PostgreSQL concurrent keys/turns/lesson isolation, foreign turn ID, reservation rollback, final-write fault, lease/deadline/late result, deletion, cancel-vs-complete, retry without duplicate user, lost start/final acknowledgements, process restart and usage atomicity. API tests assert no canonical lesson/hash/history changes. Browser UI remains disabled; exercise existing operation recovery regressions.

**Acceptance gate:** one user row per turn, at most one completed assistant, operation/message states agree after every tested outcome; zero note mutations/model replay on GET/restart. Dependencies: phase 1; usage-finalization gap must be resolved without changing existing generation guarantees.

### Phase 3 — chat transport, history UI and recovery (finish task 22)

**Objective/features:** bounded lesson transcript/composer, status SSE with polling fallback, retry/cancel/error states, request journal, lesson switching and refresh recovery. Token deltas only if the alternative was explicitly approved and all adapter/transport safeguards pass.

**Reuse/files:** `OperationStatus.tsx`, current SSE router, `api.ts`, existing IndexedDB utility and navigation handles; new `apps/web/src/chat/*`, `chat-start-recovery.ts` under existing persistence, plus workspace/styles integration. Extend `tests/support/server.ts` with deterministic chat delay/failure fixtures.

**Steps:** status hook preserving existing operation screens → paged transcript → explicit composer Send with flush/journal → cancel/retry → refetch durable result on done/reset → route/refresh recovery and accessibility. Known durable chat can continue offscreen; no new generation on reconnect. API uses §8; no new SQL schema.

**Verification:** unit/component tests for lesson-keyed state, event deduplication, out-of-order fetches and storage failure; PostgreSQL SSE disconnect/reset/polling and completed-result references; E2E two independent lesson histories, rapid switches, reload during turn, lost Send acknowledgement, failed credentials, cancel/fail, interrupted API process and no note writes. If real streaming is approved, test partial output interruption/buffer reset/backpressure and no automatic replay after first delta.

**Acceptance gate:** history is isolated and recoverable; disconnect/reload never creates another user/call; partial/incomplete output cannot be completed or inserted. Dependencies: phase 2; leave public chat exposure gated until phase 4's bounded context acceptance passes.

### Phase 4 — bounded saved-note tutoring context (task 23)

**Objective/features:** implement §5 deterministic context priorities, exact revision capture, complete history-pair selection, prerequisite labels and omission/older-context display. Enable the public chat workflow only after this gate.

**Reuse/files:** existing `context.ts`, edit capture helpers, canonical document reader and adapter budget; new `chat-context.ts` and tests; extend manifest schema compatibly and chat UI badges/source summaries. No summary table/vector store or lesson mirroring.

**Steps:** exact saved lesson/path capture → selected/adjacent/lexical ranking → prerequisite and completed-pair history → whole-block budgeting → context fingerprint/retry checks → UI provenance. Do not refactor generation/selection semantics merely to share code.

**Verification:** unit tests for stable ranking, Unicode/UTF-8 bounds, oversized blocks, intact code/math, nested nodes, empty/manual notes, skipped/missing prerequisites and six complete turns; PostgreSQL saved custom edits/restore, concurrent metadata/notes changes, consistent snapshot, changed-context retry rejection, source ownership and bounded reads; E2E edit-save-ask, see correct captured revision, edit during chat and see old-context badge, ask again against new revision. Fake provider echoes safe test sentinels to prove input selection; no real prompts in logs.

**Acceptance gate:** no obsolete generated draft or cross-lesson conversation enters context; every omitted/oversized input is handled truthfully; full serialized input fits the selected configuration's budget. Dependencies: phases 2–3; configurations too small fail safely before cost.

### Phase 5 — explicit insertion and isolated manual save (task 24)

**Objective/features:** source-message preview, fresh cursor capture, safe shared pure insertion, one undo event and journal-first exclusive immediate ordinary save. Refresh/unknown acknowledgements replay immutable bodies; stale anchors require explicit re-placement, not model regeneration.

**Reuse/files:** `accept-edit.ts`, sequence/barrier plugins, history/step rebinding, `Autosave`, `RecoveryDraft`, `PersistentNotes` and standard LessonService PUT; add `packages/shared/src/insertion.ts` implementation and `apps/web/src/editor/insert-text.ts`/insertion preview UI. Keep AI-edit wrapper and wire semantics intact; no new backend acceptance endpoint or SQL schema.

**Steps:** capture/transform fixtures → typed local isolation metadata/backward-compatible IDB → mandatory journal/exclusive queue → UI preview → confirmation → exact dispatch/immediate PUT → immutable retry/conflict/reload handling. Enable the action only after helper, queue and PostgreSQL manual-save gates pass.

**Verification:** unit editor/queue tests for UTF-16, nested safe cursors, nonempty/unsupported selections, all surrounding marks/attrs/assets, ID behavior, journal-before-dispatch, one undo/redo event, rejected storage and intervening transactions; PostgreSQL manual CAS/receipt replay after later saves, snapshot/assets/rollback, unchanged ChatMessage and applied chat operation; E2E reject/change cursor/stale typing/undo, two-tab conflict, lost response + refresh, navigation guards, undo as new revision and restore. Re-run all Milestone 4 insertion/acceptance regressions.

**Acceptance gate:** no automatic/provisional insertion or whole-doc replacement; only intended cursor content changes; one isolated journal/body survives ambiguity; stored chat remains unchanged. Dependencies: phases 1–4 and explicit manual-save/provenance policy approval.

### Phase 6 — preferences, prerequisites and leaf progress (task 25)

**Objective/features:** course preference editing, clear default inheritance, existing reversible prerequisite choices/navigation, explicit leaf statuses and derived aggregate indicators. Protect progress-only leaf identity through add/move/wrap.

**Reuse/files:** `ModelSettings`, `workspace.tsx`, existing course/topic/prerequisite routes and schemas, `TreeService` and `LearningProgress`; new `apps/api/src/workspace/progress-service.ts`, `apps/web/src/learning/ProgressControls.tsx`, `CoursePreferences.tsx`; extend workspace/shared learning routes/contracts and tests. Conditional trigger/readiness change only as approved in principle during phase 1 and concretely reviewed here.

**Steps:** reproduce the progress-only-leaf counterexample on isolated PostgreSQL → implement/review the approved minimal forward guard migration and service fix → populated-upgrade/readiness checks → ProgressService locked writes/read aggregates → API → course preference form → prerequisite improvements → leaf/container indicators → wrap/deletion regression coverage. Never regenerate saved notes on preference changes. Progress does not change lesson revisions or, by default, treeRevision; metadata/choice writes retain existing tree revision rules.

**Verification:** unit aggregate leafhood/empty/deep tree/status-time behavior; PostgreSQL progress-vs-add/move races, no container completion, no-lesson leaf completion, wrap retains IDs/chat/progress, deletion cascades, same-state timestamp replay, metadata CAS and default inheritance; E2E two-tab scalar behavior, failed writes/unknown acknowledgement refetch, skipped edges visible/reversible, completed denominator excludes containers and includes ungenerated leaves, unchanged note JSON. API/schema/error tests ensure bounded responses.

**Acceptance gate:** totals reflect current leaves consistently; no silent progress loss or generated-note rewrite; all ownership races pass. Dependencies: prior phases and approved progress invariant fix. Migration/data repair uncertainty is a stop condition, not a waived limitation.

### Phase 7 — objectives, guided reading, reflection and recall (task 26)

**Objective/features:** §7 read/edit modes, objectives, transient presentation gates, uniquely paired recall reveal, unsaved scratch answers and explicit local answer insertion. No grading/attempt persistence or new document node.

**Reuse/files:** compiler's learning-role metadata, canonical schema, `NotesEditor`/`PersistentNotes`, phase 5 insertion; new `apps/web/src/learning/LearningPanel.tsx`, `ReadModeControls.tsx`, `RecallCard.tsx`, presentation/decorations helper and tests. Backend uses existing APIs only; no schema migration/version bump and no new model invocation on reveal.

**Steps:** validate/read metadata projection → flush-controlled read mode → transient section/reflection/reveal state → objective/recall UI → scratch label/discard protection → explicit answer insertion through phase 5 helper → keyboard/show-all fallback. Missing/malformed metadata never hides/losses notes.

**Verification:** unit/component tests for grouping, duplicates/orphans/nested blocks, read projection preserving exact JSON, no docChanged on reveal, edit mode always full visibility, transient scratch lifecycle and safe insert; PostgreSQL existing save/restore metadata/asset invariants plus proof reveal/scratch makes zero writes; E2E guided/self-paced/reflection combinations, manual notes empty state, keyboard answer/reveal, no implicit completion, scratch insertion one undo event/persistence, restore and refresh. Run curated educational rubric fixtures: fractions, recursion, SQL joins, tokenization and LangChain subject examples.

**Acceptance gate:** learning controls change presentation only until an explicit save-producing insertion; canonical hidden answers remain recoverable; practice input is never falsely labelled saved or graded. Dependencies: phases 5–6 and approval of guided grouping/formatting policy.

### Phase 8 — full verification and completion evidence

**Objective/features:** complete tasks 22–26 acceptance matrix, baseline regressions, production checks and `docs/MILESTONE_5.md` with actual results/limitations; no next-milestone implementation.

**Reuse/files:** root scripts, Vitest/Playwright, deterministic server factory, existing CI sequential stages; extend test files and README/CONTRIBUTING setup details only where behavior changed. No additional infrastructure/dependencies by default.

**Steps:** targeted failure matrix → full unit + PostgreSQL → production build → Chromium sequentially → credential/import/log checks → any approved fresh/upgrade migration verification → pedagogical fixture review → diff/data-preservation audit → completion record. CI already discovers new test files; change it only for a demonstrated additional check.

**Verification/gate:** every checklist item in §11 passes or is explicitly blocked; no failed test waived. Record exact commands, counts, platform, mocked versus opt-in live verification, migration inventory, rubric results and known risks. Preserve existing user work, stop owned test processes, recommend a conventional checkpoint (`feat: contextual tutoring and learning controls`) without committing. No Milestone 6 work.

## 10. Decisions, contradictions and risks

### Decisions requiring owner approval before dependent work

| Decision | Recommendation | Why it needs an explicit choice |
|---|---|---|
| A — streaming scope | Status-first SSE + durable complete answers/polling for the four current nonstreaming adapters | Consistent documented fallback; raw tokens require the separate bounded stream work in §4. Do not claim “token streaming” for status events or silently remove it if expected |
| B — chat/scratch insertion | Plain text/hard-break cursor fragment; exclusive journaled **manual PUT**, no operation field | Matches API.md. Reusing ready-edit `aiOperationId` would be a contract violation. Server-verified chat provenance/anchor would require separately approved wire/source changes |
| C — progress-only leaf invariant | Minimal forward trigger migration after a failing real-DB counterexample; preflight, preserve old data, no model changes | Existing SQL/application checks do not protect converting a progress-only leaf to container. Do not promise zero migrations despite this gap |
| D — lifecycle defaults | User pending/terminal status policy; pair sequences; retry latest failed turn only against unchanged context; completed message limit 16k/64 KiB | Existing docs leave these precise contracts open. New message/base context starts a new turn, not a silent retry |
| E — learning interaction | Current course preferences, manual completion on any leaf, guided section grouping + independent reflection pauses, transient labelled scratch | Avoid inventing mandatory generation/mastery requirements or saving hidden UI state in document JSON |

Approval of an implementation plan should explicitly include these choices. No approved architecture is changed by this planning document. If a different choice changes a contract, identify the exact affected document/schema and obtain approval before code/migrations.

### Findings required to resolve during Milestone 5

| Finding | Severity / resolution |
|---|---|
| Generic operation completion/reconcile/cancel excludes chat and does not synchronize messages | **Implementation-blocking for task 22.** Add narrow chat lifecycle branches; never merely widen kind allowlists and leave ready/orphaned turns |
| Existing measured adapter writes usage independently before completion, while DATABASE.md requires chat assistant plus usage finalization atomically | **Implementation-blocking contract gap.** Retain existing generation behavior; for chat collect bounded safe attempt measurements, pass them to a narrow terminal finalizer, insert/upsert final available usage with assistant+operation transaction. Failure paths persist available measurements with terminal status; crashes may still leave usage unknown. No fabricated token/currency counts. Test rollback after each final write |
| Input/context clipping is duplicated; generic helper byte truncation can damage UTF-8 and stops after the first large block | **Required for task 23.** New deterministic block-safe chat selector with explicit omission; reuse primitives only after tests, avoid unrelated rewrites |
| `contextManifestSchema` has no chat-history provenance; `promptVersion` type allows only the current edit override | **Required.** Backward-compatible optional manifest fields and versioned `chat-v1`; do not add free-form config bags |
| `Autosave.isolatedPending`/recovery protections are keyed to `aiOperationId` | **Implementation-blocking for task 24.** Explicit local isolation metadata + common queue helper; test AI wrappers unchanged and manual insertion cannot downgrade while pending |
| Old chat answer is based on an older revision | **Expected, not an edit permission.** Display captured revision; fresh placement/confirmation for insertion; no reuse of generation-time offsets |
| Existing course summaries omit planned progress field | **Required UI/API integration choice.** Use dedicated progress GET for accurate indicators; if summary progress is added, extend strict DTO/client schemas together. Do not hand-wave a field already present |
| Learning metadata can be missing, duplicated or orphaned after manual editing | **Required task 26 fallback.** Safe show-all/empty state, no schema-destructive “repair” or assumed mastery |
| Stale local/read-mode result fetch can overwrite current editor | **Required regression protection.** Lesson-keyed fetch epochs, original live editor ownership, no response-driven `setContent` |
| Last-committed scalar progress/choice writes differ from note CAS | **Explicit policy**, not a false concurrency guarantee. Serialize local requests, preserve completedAt on same-state retries, read after ambiguity and ask before reapplying conflicting intent |
| Large histories/context and snapshots grow indefinitely | **Bound reads/output now**, defer retention/GC to a separately approved policy. No age-based deletion of learner messages/assets |

Safe to defer: raw token streaming if fallback is approved; rich Markdown chat rendering; richer insertion nodes/structural cursor shapes; persistence of scratch answers/reveal state; authoring UI for arbitrary learning tags; mastery/scheduling; broad bundle splitting; Docker/other-browser/remote CI claims not actually tested. Existing M2 recovery eviction/duplicated-tab caveats, single-process credentials, best-effort provider abort and educational uncertainty remain documented risks.

## 11. Verification commands and final acceptance checklist

Commands below are **future implementation verification**, not checks executed for this plan. `npm.cmd` is PowerShell's equivalent of `npm`. Use a dedicated migrated `learnspace_test...` database, never the developer/learner URL. Keep PostgreSQL integration and Playwright sequential because tests modify shared workspace defaults. Build production assets before browser tests.

```powershell
npm.cmd run db:validate
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:integration
npm.cmd run build
npm.cmd run test:e2e
git -c core.safecrlf=false diff --check
```

Existing focused scripts accept file arguments, e.g. `npm.cmd run test:integration -- tests/integration/chat.test.ts` and `npm.cmd run test:e2e -- tests/e2e/chat.spec.ts` once those proposed files exist. Include current `selection-edits.test.ts`, `selection-editing.spec.ts`, `ai-generation.test.ts`, operation restart, workspace, adapter and autosave tests in regressions. `npm.cmd run check` combines Prisma/lint/typecheck/unit/build but does **not** replace integration/browser gates. No new test script is necessary unless an approved live-stream option requires one.

If the trigger migration is approved, run `db:migrate`/`db:status` only against separately created test databases for empty and populated-upgrade fixtures; generate Prisma only if the schema requires it. Never use reset/db push or edit existing migrations. CI already runs integration before build/browser and includes migration/seed repeatability checks. Do not install dependencies during this planning task or silently upgrade the pinned SDKs during implementation.

Mandatory providers are deterministic fakes, including invalid output, delay, cancellation, deadline/lease expiry, response loss and rollback; real SDK adapter fixtures remain isolated from personal keys. Live calls are explicitly opt-in, provider/model/configuration labelled and bounded. If streaming is approved, distinguish fake chunk/SDK compatibility from live streaming verification. Curated rubric checks and human review must record their actual basis; fake outputs/schema checks do not establish a live model's factual accuracy or the PRD's universal quality target.

Final end-user definition of done:

- [ ] Open saved manual/AI notes; no lesson/chat generation on open, reload, reveal, progress updates or preference changes.
- [ ] Save a customization, send a question, and demonstrate captured saved revision/content and omission disclosure.
- [ ] Switch lessons and return: each retains only its own durable ordered conversation. Unsent/unknown Send intent is recoverable or explicitly discarded, never silently resent as a new turn.
- [ ] Lose SSE/connectivity or refresh: recover operation/history via existing GET/polling/discovery with zero duplicate provider work. Status-first versus token behavior is labelled truthfully.
- [ ] Cancel, time out, expire a lease, restart, lose ownership or delete an owner: no completed partial assistant and no late note/message resurrection. Cancellation-vs-completion has one truthful durable outcome.
- [ ] Retry a failed turn explicitly without duplicating its user message; changed content/context requires a new turn. Replay after committed-but-lost completion resolves the same message.
- [ ] Preview a completed response, reject without document/hash change, then insert explicitly at a fresh safe cursor. Only the intended fragment changes; existing marks/IDs/metadata/assets survive.
- [ ] Any intervening document edit/undo/redo makes the insertion anchor stale; caret movement alone does not retarget it. Re-placement uses saved response text without a model call.
- [ ] Journal failure prevents dispatch/HTTP; accepted insertion is one undo event and one exclusive save. Lost acknowledgements/refresh replay the exact mutation/body. New typing and generic overwrite cannot consume an unknown isolated mutation.
- [ ] Two tabs cannot overwrite newer saved notes via insertion. Conflicts retain local JSON; history/restore/image accessibility work after chat and scratch insertion.
- [ ] Workspace defaults affect new courses only; course preferences/objectives use tree CAS and never rewrite saved notes. Running chat clearly retains its captured context; future turns use new settings.
- [ ] Prerequisite study/skip remains visible/reversible, with no implicit completion or generation. Progress counts actual leaves including ungenerated/skipped leaves; containers are derived; wrap/move/delete preserve or intentionally remove owned records safely.
- [ ] Read/learn controls and reveal/scratch input make zero canonical writes. Edit mode exposes all saved content; malformed metadata cannot conceal/drop it. Explicit scratch insertion uses the same safe save path, without provider calls.
- [ ] Required contract/unit/API/PostgreSQL/editor/browser/security/failure/rubric gates pass; M1–4 regressions pass; actual counts/commands/limitations and any approved migration appear in `docs/MILESTONE_5.md`.
- [ ] Learner data, existing migrations, corrected designs and unrelated user changes are preserved; no commit/push/deployment or Milestone 6 implementation occurs without separate authorization.

Recommended sequence: resolve A–E → contracts/invariant fixtures → durable chat → transport/history → bounded context → explicit insertion → preferences/progress → learning controls → full verification. This document is the requested planning artifact only. Stop for owner review and approval before implementing any phase.
