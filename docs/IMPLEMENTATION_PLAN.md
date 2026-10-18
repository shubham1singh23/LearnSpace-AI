# Seven-day implementation roadmap

Proposed plan; implementation starts only after owner approval. Exactly seven implementation workdays, not calendar dates. One engineer, bounded MVP, working vertical slices. An unfinished gate carries forward and moves release readiness; do not skip reliability to preserve the date. P0/P1 scope is defined in [PRD](PRD.md); [risks](RISKS.md) drive verification.

## Exact task order and daily gates

| Day | Execute in this order | Dependencies | Milestone acceptance and checkpoint |
|---|---|---|---|
| 1 — foundation | 1. Choose compatible Node LTS and pin npm/package versions. 2. Create npm workspaces/apps/packages with strict TS boundaries. 3. Compose PostgreSQL, environment validation and initial course/topic/lesson/version/asset-reference migrations including their custom SQL invariants. 4. Shared Zod contracts/errors and headless document schema baseline. 5. Local API health/origin protection and Vite shell. 6. CI scripts and real DB test harness. | Approved documentation; Docker/Node available | Fresh DB migrates, workspace builds/typechecks, health fails correctly with DB down, secrets never bundled, CI unit/integration skeleton runs. Recommend Git checkpoint `chore: scaffold local workspace and persistence contracts`. |
| 2 — persistent manual workspace | 7. Course/tree/dependency CRUD and revision-checked ordering. 8. Manual leaf lesson create/load/save APIs, minimal raster upload/storage/asset resolution and missing persistence migrations. 9. Tiptap nodes/marks, stable block IDs and explicit formatting/code/table/math/image controls. 10. Sequential autosave, receipts and recovery drafts. 11. Navigation flush, conflicts, snapshots/restore. | Day 1 contracts and DB | Create nested course, edit all supported nodes including an uploaded image, reload/restart and retain JSON; two-tab CAS conflict; lost save response retry; save during typing/navigation; restore creates N+1; tree cycles/cross-course parents fail. Checkpoint `feat: persistent editable learning workspace`. |
| 3 — model setup and course generation | 12. Four LangChain text adapters and registry. 13. Env/session onboarding and connection test. 14. Durable operations, leases, cancellation and status transport. 15. Syllabus draft generation/validation/review/commit. 16. Guarded initial lesson generation and regeneration preview/commit. | Day 2 persistence and stable schemas | Fake models test all paths; optional live smoke per configured provider reports actual result; duplicate opens yield one lesson; reopen makes zero AI calls; stale/cancelled generation cannot commit; changing model retains data; failed schema validation saves nothing. Checkpoint `feat: model onboarding and on-demand course generation`. |
| 4 — precise AI editing | 17. Capture/verify selection and block identities. 18. Action-specific prompt/fragment schemas and shared pure transformations. 19. Selection toolbar and preview/reject. 20. Strict staleness checks and one editor transaction with isolated immediate acceptance save. 21. Server transformation validation, atomic operation application and autosave/undo races. | Day 2 transaction/history and Day 3 operations | Every action changes only intended slice/location; reject leaves hash unchanged; any intervening document edit disables acceptance; another tab cannot bypass server CAS; reject/cancel races resolve atomically; client/server transform parity; undo is one event; no whole-doc setContent used for targeting. Checkpoint `feat: previewed selection AI edits`. |
| 5 — contextual tutoring and retention | 22. Persist isolated chat turns and SSE fallback/reconnect. 23. Bounded revision-aware context selection. 24. Explicit chat insertion. 25. Preferences, prerequisite study/skip and leaf progress. 26. Objectives, reflection pauses and active recall. | Days 3-4 model/operation/editor contracts | Chat sees saved custom edits; lesson switch retains distinct history; interrupted streaming cannot create completed partial messages; response insertion is scoped/undoable; skipped prerequisites remain visible; completion count excludes containers. Run educational rubric fixtures. Checkpoint `feat: contextual tutoring and learning controls`. |
| 6 — images and portable exports | 27. Harden day-2 asset lifecycle with GC/proposal-reference checks and export lease/pin migrations. 28. Separate image config and one verified generation adapter with preview/cursor guards. 29. Saved JSON Markdown visitor and hierarchy manifest. 30. DOCX visitor and warnings. 31. ZIP streaming, assets, consistent snapshots, lease/pins and cleanup. | Day 2 working uploads/JSON schema; Day 3 config/operations | Asset upload/generation round-trip; stale cursor cannot insert unexpectedly; both ZIP formats preserve hierarchy/custom edits/assets and ungenerated placeholders; zero model calls during export; filenames/path attacks fail; DOCX fixture inspected; cancellation releases pins; deletion is blocked during export. Checkpoint `feat: images and saved-course exports`. |
| 7 — integration and release gate | 32. Run full failure/race matrix. 33. Accessibility/responsive workflow pass. 34. Dependency/secret/security checks. 35. Fresh-clone setup and backup instructions, README/CONTRIBUTING/license decision. 36. Full CI and release checklist; document deferred/failed scope. | All prior gates | Unit + PostgreSQL integration + Playwright + production builds actually pass; fresh environment tested; no critical educational rubric failure; no known data-loss race. Checkpoint `docs: validate and document MVP release`. Publish only a core preview if required features remain incomplete. |

Each numbered task is the next implementation unit; do not start later convenience features ahead of unresolved persistence gates. Within a task, tests precede or accompany the risky behavior; no simultaneous unrelated refactors. Do not create commits without task authorization; recommend named checkpoints after successful milestones and report dirty files accurately.

Day labels define target work packages, not evidence that one developer can finish each in eight hours. Days 2, 3 and 6 are particularly dense. If a gate takes longer, retain task order and extend elapsed workdays; the requested seven-day plan remains a target, not a fixed-scope delivery guarantee. All P0 and P1 requirements remain scheduled; incomplete work is reported explicitly. Schema migrations are staged: core persistence day 1/2, provider/operation/usage/settings day 3, chat/progress additions day 5 if not already needed, export lease/pin tables day 6. Do not implement unused services on day 1 just because their schema is proposed.

## MVP requirement-to-gate traceability

| PRD journey | Planned tasks | Required verification |
|---|---|---|
| P01 model onboarding, four text providers, separate image config | 12-14, 28 | Environment/session secret handling, configured=false after restart, invalid key/model/capability fixtures, history retained after switch |
| P02 syllabus only | 15 | Draft review/commit idempotency, tree validation, zero lesson generation during planning |
| P03 editable arbitrary hierarchy | 7 | Rename/add/delete/move/reorder/wrap, same-course/cycle constraints, prerequisite choices |
| P04 on-demand lessons | 8, 16 | Manual blank alternative, explicit Generate action on opened leaf, duplicate generation, stale tree context, reopen without AI |
| P05 rich editable notes | 8-11 | All nodes/marks, explicit formatting controls, upload image round-trip, autosave/navigation/history |
| P06 selected text AI | 17-21 | All seven actions, supported selection shapes, preview/reject, exact transformation and stale/race guards |
| P07 contextual chat | 22-24 | Isolated lesson histories, edited-note context, bounded excerpts, reconnect/interruption/retry, insertion |
| P08 preferences and retention | 25-26 | Depth/style/pace, dependency skip/study, reflection/reveal attrs, scratch-vs-saved answer behavior, explicit completion |
| P09 recovery | 10-11, 16, 21, 32 | Save receipts, conflicts, drafts, restore/regeneration races and provenance |
| P10 images | 8-9, 27-28 | Upload plus one generated-image provider, separate config, preview/reject, cursor staleness and asset references |
| P11 both export formats | 29-31 | Saved customized data, exact tree, relative assets, placeholders, warnings, ZIP safety and zero model calls |

Accessibility starts with each UI feature, with a full keyboard/responsive pass at task 33. Test meaningful behavior as each task lands, not only on day 7. Core document fixture visitors can be drafted alongside schema changes without exposing export endpoints ahead of task 29; every enabled editor node must have an explicit conversion contract from day 2.

## First implementation task proposed for approval

Execute day 1 tasks 1-6 as the first bounded milestone: npm workspaces, compatible pinned toolchain, initial PostgreSQL/Prisma persistence schema and invariant migrations, shared contracts/headless document schema, minimal React shell/Express health endpoints, environment validation, tests and CI. Defer feature-specific operation/export migrations to their scheduled tasks. No course-generation UI or model calls yet. Deliver a runnable foundation with documented setup and actual build/test output. This makes the next persistence feature independently testable.

Before adding dependencies, inspect package compatibility and current official APIs; the documentation proposal intentionally does not pin speculative versions. Add runtime dependencies only for the scheduled feature. `.env.example` uses empty/dummy credentials, never valid keys. License choice remains an explicit owner decision before release and does not block day 1.

## Verification strategy by layer

| Layer | Method | Evidence to retain |
|---|---|---|
| Contracts/domain | Vitest fixtures for trees, documents, provider mapping, filenames, context budgets | Test name and observed pass/fail, no credentials |
| Persistence | Vitest against isolated real PostgreSQL DB; apply migrations from empty; concurrent clients/barriers for races | Migration output, CAS/unique-constraint behavior, rollback assertions |
| Editor | ProseMirror transaction unit tests plus browser integration | Untouched slice equivalence, undo behavior, stale selection/revision rejection |
| AI | Deterministic fake adapters for CI; malformed/refusal/timeout/stream-break fixtures; optional paid/live smoke | Provider/model/config date, tested capabilities, rubric; never claim all models tested |
| Export | Golden Markdown/ZIP paths, DOCX XML relationships and visual fixture inspection | Assets resolve, warnings present, exact saved revisions, no model calls |
| End-to-end | Playwright full learner journey with seeded DB/fake AI | Failure traces/screenshots free of secrets, both browser tabs where required |
| Release | Fresh-clone instructions, build/typecheck/test/lint scripts, secret scan and loopback/origin checks | Exact commands/results, platform and skipped checks |

CI proposed sequence: `npm ci`; Prisma generate; migration deploy to isolated PostgreSQL; `npm run typecheck`; `npm run lint`; `npm run test:unit`; `npm run test:integration`; `npm run build`; `npm run test:e2e`. These scripts do not exist yet; implementation must create and execute them before claiming success. Playwright uses production-built assets and a test API, never developer data. Migrations get a separate upgrade fixture once a second migration exists.

## Failure matrix and release rules

Exercise DB outage during save, HTTP response lost after commit, typing during save, browser route switch, API restart during generation, double-click generation, lease expiration with delayed provider response, schema-invalid AI output, key failure/rate limit, stale selection, two-tab overwrite, version restore conflict, image write rollback, export snapshot during edits, asset GC during export, and download disconnect. Passing happy paths alone does not satisfy release.

Track each P0/P1 checklist item as not started/in progress/verified/blocked with a linked test or manual observation. Never label planning checks as application tests. If time is tight, defer polish, encrypted key vault and unrequested scale work; retain accuracy review, revision protection and export fidelity gates. No automatic deployment or publication is part of this plan.
