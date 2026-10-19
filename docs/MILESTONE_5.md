# Milestone 5 — contextual tutoring and retention

Completed roadmap tasks **22–26** in the approved eight-phase sequence on 2026-10-19. Authority: `AGENTS.md`, `MILESTONE_5_PLAN.md`, corrected architecture/API/database/editor/AI designs and Milestone 1–4 records. Decisions A–E were explicitly approved. No Milestone 6 implementation, dependency installation, commit, push or deployment was performed.

## Delivered workflows

### Lesson chat and durable execution

- Lesson-scoped, ordered user/assistant history and explicit Send. Opening, reloading, reading or revealing content does not generate anything.
- Send briefly freezes/flushed notes through their existing owner, captures the saved revision and selected eligible block IDs, then releases editing. Invalid notes, recovery and unknown isolated saves prevent capture.
- A mandatory IndexedDB start journal precedes POST. It retains the exact key/body after an unknown acknowledgement and survives refresh. Known operations/history recover through existing durable status/discovery infrastructure without another model call.
- User reservation and operation creation are atomic. Sequences reserve even user/odd assistant pairs; failed turns leave gaps. One active chat scope exists per lesson. Global turn-ID ownership, scope/key/body replay and conservative latest-failed-turn retry are enforced before invocation.
- Completed validated plain-text answers are persisted directly as applied operations. Assistant, completed user, available usage and durable result reference commit together under course → lesson → operation locks. There is no provisional assistant row or ready chat proposal.
- Cancellation, execution failure and bounded expired-lease reconciliation synchronize the owning pending user. Late, cancelled, expired or deleted-owner executions cannot publish an answer. Restart never redispatches provider calls.
- Chat may complete against its labelled older revision while notes change. It does not mutate lesson JSON, lesson revision, history, assets or progress. Retrying an unsuccessful turn requires unchanged original content/revision/context; otherwise ask a new question.
- Progress is **status-first SSE with polling fallback**, followed by a complete durable response. **Token streaming is not implemented or claimed.** Model identity and captured revisions are visible through operation status; omitted context is disclosed.

### Saved-note context

`chat-context.ts` captures saved edited notes, course preferences/goal/path/objectives, at most three prerequisites and six complete conversation pairs. Pending and unsuccessful turns never enter complete conversation context; other lessons' conversations are excluded.

The selector prioritizes selected eligible blocks, adjacent blocks, headings and deterministic lexical matches. It includes whole blocks, preserving Unicode and intact code/math text rather than byte-slicing. Unsupported images, missing prerequisites, history limits and budget omissions are recorded. Skipped prerequisites remain labelled rather than being treated as mastered or deleted.

The entire serialized system plus input must fit `min(12000, contextWindow − configured output reserve − 1024)` UTF-8 bytes, using the same captured model configuration as execution. This conservative byte budget is not measured token usage. Oversized mandatory input fails before invocation; optional blocks/history are omitted truthfully. Manifests retain actual source IDs/revisions/block IDs, history IDs, tree revision, algorithm version and context hash, without raw prompts or credentials.

### Explicit chat and practice insertion

- A completed answer opens a separate plain-text preview. Learners place a fresh collapsed cursor inside an eligible paragraph/heading, including safe nested text, preview and explicitly confirm.
- Shared pure transformation verifies full document/boundary/source hashes, block ID, UTF-16 boundary, revision and editor/local transaction identity. Surrogate splits and unsafe cursors fail. Any document transaction—including undo/redo or an outside edit—stales placement; caret movement alone does not retarget it.
- Literal text/hard breaks are inserted at exactly that cursor. Markup is not interpreted. Existing surrounding marks, block shells, IDs, metadata and unrelated nodes are preserved. No whole-document `setContent` is used.
- One accepted insertion is one isolated undo event and immediate **ordinary manual PUT**, with neither operation field. The chat operation/message remains unchanged. Server provenance is `manual`; this does not claim server-certified chat-source anchoring.
- The existing save queue now supports typed local insertion isolation. Its immutable request and local metadata must commit to IndexedDB before dispatch. Unknown outcomes prevent new typing, downgrade, overwrite, journal discard and unsafe navigation. Refresh resumes/replays the original mutation/body only. Definitive rejection retains comparison/download/discard recovery.
- Standard lesson CAS, receipts, snapshots, historical asset references and restore remain authoritative. Milestone 4's AI-edit wrapper and server reconstruction remain independent and unchanged in meaning.

### Preferences, prerequisites and progress

- Course-specific teaching preferences use existing tree-revision CAS. Drafts survive rejected writes and can explicitly refresh their base metadata revision. Workspace defaults still affect new courses only; existing prose is never regenerated.
- Prerequisite study/skip choices stay visible, reversible and navigable. Overlapping local writes are disabled until a tree refetch, including ambiguous acknowledgement recovery.
- Any actual leaf, including an ungenerated leaf, can explicitly be not started, in progress or completed. Opening, reading, chat and generation never complete it implicitly.
- Course-locked writes serialize with tree mutations. Repeated completion preserves its timestamp; leaving completion clears it. Scalars follow the approved last-committed explicit-intent policy, not lesson CAS. Ambiguous outcomes require a read before offering another change.
- Bounded iterative totals count actual leaves, include ungenerated/skipped leaves, derive containers and handle empty courses. Explicit container progress is rejected. Add/move protects progress-owning leaves; Wrap retains the original identity and progress.

### Objectives and reading/practice

- Current topic objectives are displayed separately from authored objective prose.
- Entering reading mode flushes notes; editing exposes all content through the same live editor/history. Guided pace uses top-level heading sections, with Previous/Continue and Show all controls.
- Reflection pauses and recall reveal use decorations and non-document transactions. Nested reflections are supported. Unique ordered recall groups pair questions/answers; malformed, duplicate, orphaned or misordered metadata falls back to visible content.
- Scratch answers and reveal state are transient. Answers are explicitly labelled practice-only, not saved or graded, and navigation guards require explicit resolution of nonempty scratch input. Insert my answer uses the same plain-text preview/manual save path and makes no model call.
- Legacy/manual notes without learning metadata remain readable/editable and show an honest empty practice state. No hidden-content deletion, new document node/schema version, mastery score, grading model or practice table was added.

## API and contract additions

| API | Behavior |
|---|---|
| `POST /api/v1/lessons/:id/chat-turns` | Strict saved revision/message/turn/selected-block/retry request plus UUID idempotency key; existing 202 operation handle |
| `GET /api/v1/lessons/:id/messages` | Ordered bounded pages, owned exclusive before/after cursors and active operation ID |
| Existing operation GET/events/cancel/course discovery | Chat kind, durable applied reference and synchronized terminal recovery; no duplicate status executor |
| Existing `PUT /api/v1/lessons/:id` | Unchanged manual wire contract for explicit insertion; local isolation metadata is not sent |
| `PATCH /api/v1/topics/:id/progress` | Explicit leaf status with coherent timestamps |
| `GET /api/v1/courses/:id/progress` | Bounded leaf/container totals and tree revision |
| Existing course/preferences/prerequisite APIs | Reused revision/scalar conventions |

Shared strict Zod additions cover chat start/message/page/output/start-journal, progress, insertion anchors/isolation and optional chat context provenance. Old operation manifests/results and existing ordinary/AI recovery drafts remain parseable. Input/output is limited to 16,000 UTF-16 units/64 KiB, selected IDs to 100, history pages to 100 and course traversal to 2,000 topics. Unknown model keys and invalid Unicode fail. There is no HTML/Markdown execution or model-supplied asset insertion.

All four existing LangChain text adapters are reused. Mandatory adapter/transport fixtures cover OpenAI, Anthropic, Google Gemini and Ollama; chat workflow tests use deterministic fake providers. No live compatibility or factual-accuracy claim follows from those tests. No personal credentials, live provider calls or tracing were enabled.

## Database migration and preservation

One approved forward migration: `prisma/migrations/20261019000100_progress_leaf_guard/migration.sql`.

Before creating it, an isolated PostgreSQL test demonstrated that the old guard allowed a child beneath a progress-only leaf. A read-only preflight then found **0 invalid progress containers**, with the original **1 course, 4 topics, 0 lessons, 0 progress rows** intact. The new migration locks the affected tables, aborts if invalid historical progress exists, and replaces only the parent validation function to include progress ownership. It never repairs/deletes data. Application add/move guards return an explicit Wrap alternative. Readiness requires the third migration.

The migration was applied only to isolated test databases. The learner/development database was not migrated, reset or overwritten. Before upgrading it, back up PostgreSQL and assets and run the normal migration command; a preflight rejection requires owner review, not deletion of progress or modification of migration history.

Final data audit: both `learnspace_test_m2` and the newly created `learnspace_test_m5_clean_20261019` contain **1 seeded course, 4 topics, 0 lessons and 0 progress rows**. Test-owned records were cleaned by their fixtures. The clean verification database remains available; no database was dropped. The owned test cluster was stopped after verification, restoring its original stopped state. Unrelated running processes were left alone.

Verification includes the original failing counterexample becoming green, add/move races, a valid populated upgrade preserving progress/timestamps, rejection of invalid historical data, clean migration-from-empty, repeated migration deployment and seed repeatability. The two previous migrations, Prisma schema and all package/lock files remain unchanged.

## Files delivered or extended

The worktree already contained Milestone 4 changes and its completion record. They were retained; this list identifies Milestone 5 additions/extensions rather than attributing that existing work to this milestone.

| Area | Files |
|---|---|
| Shared | `packages/shared/src/chat-contracts.ts`, `learning-contracts.ts`, `insertion.ts`, their tests; `ai-contracts.ts`, `index.ts` |
| AI | `packages/ai/src/chat-pipeline.ts`, `chat-pipeline.test.ts`, `index.ts` |
| API | `apps/api/src/ai/chat-service.ts`, `chat-context.ts`, `chat-context.test.ts`, `operations.ts`, `router.ts`; `workspace/progress-service.ts`, its test, `workspace/router.ts`, `tree-service.ts`; `readiness.ts` |
| Chat/editor | `apps/web/src/chat/ChatPanel.tsx`; `editor/InsertionPreview.tsx`, `insert-text.ts`, `PersistentNotes.tsx`, `extensions.ts`, `editor.test.ts`; `OperationStatus.tsx`, `workspace.tsx` |
| Recovery | `apps/web/src/persistence/autosave.ts`, `recovery.ts`, `autosave.test.ts`, `chat-start-recovery.test.ts` |
| Learning | `apps/web/src/learning/CoursePreferences.tsx`, `ProgressControls.tsx`, `LearningPanel.tsx`, `presentation.ts`, `presentation.test.ts` |
| SQL | New progress-leaf migration above; no model change |
| Verification | `tests/integration/chat-contracts.test.ts`, `chat.test.ts`, `learning.test.ts`, `operation-restart.test.ts`; `tests/e2e/chat.spec.ts`, `learning.spec.ts`; `tests/support/chat-fixture.ts`, `server.ts` |
| Documentation | `README.md`, `CONTRIBUTING.md`, this completion report |

Existing CI discovers these tests and already runs database/browser stages sequentially. No CI infrastructure change was needed.

## Phase acceptance evidence

| Phase | Observed gate |
|---|---|
| 1 — contracts/invariant fixtures | 21 targeted unit/compatibility tests, 2 PostgreSQL constraints and 1 manual browser smoke; Prisma/lint/typecheck passed |
| 2 — durable chat | Pipeline unit test; 18 initial chat/operation/selection PostgreSQL regressions; 7 expanded chat/restart checks; no UI Send enabled |
| 3 — transport/history/recovery | IndexedDB isolation test and Chromium history/refresh/polling check; lint/typecheck/web build passed; Send remained gated |
| 4 — bounded context | 4 context unit tests, 6 chat PostgreSQL tests, 2 saved-context/start-recovery browser tests; Send enabled after context gates |
| 5 — explicit insertion | 21 helper/editor/queue tests, 28 PostgreSQL persistence regressions and 16 browser chat/M4 tests; acceptance enabled after helper/queue/server gates |
| 6 — preferences/progress | Defect reproduced before migration; preflight and migration; aggregation test, 15 learning/database integration tests and preference/progress browser gate |
| 7 — reading/recall | 13 presentation/editor unit tests and 2 learning browser tests; lint and web build passed |
| 8 — full verification | Results below; earlier failures corrected and rerun rather than waived |

Counts in phase rows are successive targeted runs, not additive totals.

## Actual final verification

Environment: Windows PowerShell, Node **24.19.0**, npm **11.17.0**, PostgreSQL **18**, Chromium, one browser worker. PostgreSQL integration and Playwright never overlapped on the same database.

| Command/check | Observed outcome |
|---|---|
| `npm.cmd run check` | Passed Prisma validation, lint, workspace/tool typechecks, full units and every production build |
| `npm.cmd run test:unit` through check | **105 passed**, 22 files; includes Milestone 1–4 and four-adapter deterministic regressions |
| `npm.cmd run test:integration` with isolated `TEST_DATABASE_URL` | **60 passed**, 11 files; real PostgreSQL including process restart, constraints, receipts, rollback, assets and restore |
| `npm.cmd run test:e2e` after final UI fix | **34 passed**, Chromium, 1 worker |
| `npm.cmd run test:e2e -- tests/e2e/generation.spec.ts --grep 'lost syllabus start' --repeat-each=3` | **3 passed** after correcting duplicate workspace sibling keys |
| Final `npm.cmd run lint` and `npm.cmd run build -w @learnspace/web` | Passed after prerequisite recovery/key fixes; latest UI typechecked and production bundled |
| Final focused `npm.cmd run test:unit -- apps/api/src/ai/chat-context.test.ts` | **4 passed**, including explicit unsupported-image omission assertions |
| `npm.cmd run db:migrate`, `db:status` on `learnspace_test_m2` | 3 migrations applied/up to date |
| `db:migrate`, `db:status` on new `learnspace_test_m5_clean_20261019` | All 3 migrations applied from empty; repeated deployment had no pending migrations |
| `npm.cmd run db:seed` twice on the new isolated database | Passed; no lesson generation or content rewriting |
| `git -c core.safecrlf=false diff --check` | Passed |
| Protected baseline hash audit | 22 files unchanged: corrected docs/M1–4 records, existing migrations, schema and package files |
| Production web credential-sentinel scan | `browser-fixture-secret` and `server-only-fixture-key` absent |
| Live providers, other browsers/platforms, remote CI | Not executed; no success claimed |

Corrections made before passing gates: unsupported newer string API replaced with compatible Unicode validation; an empty-paragraph fixture corrected; strict test annotations and an undo-save acknowledgement wait fixed; Windows test-runner cleanup/tsx user-info permissions resolved by rerunning owned test commands outside the restricted sandbox. The first broad browser run reported 33 passes/1 failure: duplicate React sibling course-ID keys left stale syllabus controls. Distinct activity/syllabus/progress keys fixed the application defect; three focused repetitions and the full 34-test rerun passed. No test was skipped or weakened to waive a failure.

Five curated fractions/recursion/SQL-join/tokenization/LangChain fixtures verify deterministic question/answer metadata alignment and presentation. They do not constitute a live educational-model quality benchmark or satisfy a universal factual-accuracy guarantee.

## Limitations and remaining risks

- Status SSE is not token streaming. Responses are bounded complete plain text; rich chat Markdown and structural insertion are deferred.
- Context selection is deterministic and conservative; large mandatory metadata/questions/selections can fail the input budget. Omitted context and captured revision are visible, but schema validation cannot establish educational truth.
- Retry is intentionally restricted to the latest unsuccessful unchanged turn. Notes/preferences/context changes require a new explicit question. History is retained indefinitely with bounded page reads; retention/GC needs separate approval.
- Cursor insertion supports safe collapsed paragraph/heading positions only. It does not certify message provenance on the server or introduce automatic rebasing. Any document transaction requires a fresh preview.
- IndexedDB/session identity/eviction limitations inherited from Milestones 2–4 remain. Mandatory journaling prevents unjournaled dispatch but cannot prevent external storage deletion. Duplicated browser tab scopes retain the existing caveat.
- Scratch/reveal/reading-position state is transient and not recoverable after refresh; nonempty scratch prompts navigation resolution. Malformed recall metadata falls back to showing all content. Reading controls and preview are functional, with broader responsive/accessibility polish reserved for the release gate.
- One API process and server-memory session credentials remain the operating model. Provider abort/billing is best effort; crash-time usage may remain unknown. Durable ownership prevents late publication, not exactly-once provider billing.
- The forward migration deliberately stops on invalid historical progress. No automatic data repair is included. Only isolated databases were inspected/migrated during this milestone.
- Production builds retain nonfatal Zod annotation and large frontend-chunk warnings. Browser verification covers Chromium only; live providers and remote CI were not run.

## Recommended next milestone

After separate approval, Milestone 6 **tasks 27–31**: hardened asset lifecycle/GC and export pins, separate image configuration plus one verified image-generation adapter, saved-JSON Markdown and DOCX visitors, and bounded ZIP/export snapshot/lease handling. Preserve exact hierarchy, ungenerated placeholders, customized notes and historical assets; exports must make zero AI calls. None of that work began here.

Recommended review checkpoint: `feat: contextual tutoring and learning controls`. Existing changes remain uncommitted; no commit/push/deployment was performed. Stop at Milestone 5.
