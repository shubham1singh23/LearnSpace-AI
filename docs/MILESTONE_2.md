# Milestone 2 completion record

Date: 2026-10-18. Scope: approved roadmap tasks 7–11, executed in the owner's eight-phase order. This delivers the persistent **manual** workspace, not the complete AI product. No Milestone 3 work, AI calls, chat, exports, authentication, Redis, Kafka, deployment, commit, or push was performed.

The corrected architecture documents, ADR, AGENTS.md, Prisma schema, and both existing migrations were left unchanged. The pre-existing uncommitted formatting/newline changes in `docs/MILESTONE_1.md` were preserved.

## Delivered phases and gates

| Phase | Delivered behavior | Observed gate evidence |
| --- | --- | --- |
| 1 — Shared contracts and compatibility | Strict course/tree/lesson/receipt/restore/history/asset contracts; one Tiptap extension set supplies browser and headless ProseMirror schemas; semantic JSON validation rejects unknown nodes/attrs, duplicate IDs/marks, unsafe links, incompatible code marks, ragged/merged tables and structural limits. | 28 unit tests passed at the phase gate; workspace typechecks and lint passed. Every supported node/mark and empty paragraph round-tripped through the headless schema before persistence was enabled. |
| 2 — Course/topic/prerequisite management | Course CRUD, arbitrary nesting, topic metadata/objectives, complete sibling ordering, moves, explicit wrapping, confirmed deletion, prerequisite DAG and study/skip choices. Course-row locks serialize tree mutations and tree-revision checks; temporary positions avoid immediate partial-index collisions. | 15 real PostgreSQL tests passed; API typecheck and lint passed. Coverage includes nesting, order/move, cross-course parents, cycles, concurrent stale writes, populated-leaf wrapping and deletion. |
| 3 — Manual lessons and versions | Leaf-only manual creation/load; transactional revision saves, canonical content hashes, immutable prior-state snapshots, provenance, replay receipts, no-op receipts, version reads/pagination and N+1 restore. Unsupported AI operation fields are rejected. | 18 PostgreSQL tests passed; API typecheck and lint passed. Lost-response replay returns the original receipt even after later revisions; changed payload/ID reuse fails. |
| 4 — Uploads/assets | Bounded multipart PNG/JPEG/WebP uploads, actual decoding/re-encoding, pixel/byte/frame/MIME checks, random immutable storage keys, contained ID-based resolution, checksums/nosniff, and reference-protected asset deletion. | 20 PostgreSQL tests passed; API typecheck and lint passed. Historical image references remain readable and restore successfully; malformed/spoofed/oversized/cross-course cases fail. |
| 5 — Editor/workspace | Functional course/topic UI and Tiptap notes; explicit marks, headings, lists, quotes, code/language, rules, links, math, examples/analogies, table insertion and upload preview. Local ID plugin preserves one original split ID, creates fresh IDs for new/copied blocks, and supports local undo/redo. | 31 unit/DOM tests, typechecks, lint and production builds passed. All supported content round-tripped; split/copy/join IDs, undo/redo, UTF-16 text and untouched blocks were verified. |
| 6 — Autosave/recovery | 750 ms idle / 5 s maximum-delay saves, one in-flight immutable request, pending-edit coalescing, bounded retries with the same ID/body, IndexedDB draft/request recovery and explicit conflict comparison/download/load/overwrite choices. | 36 tests, typechecks and lint passed at the phase gate. Later regression coverage added separate-tab draft ownership and invalid-editor persistence guards. |
| 7 — History/navigation | Metadata history, JSON preview/download, confirmed restore, save barriers for navigation/destructive actions, browser-back blocking and beforeunload warnings. Lost restore acknowledgements keep editing paused and retry the same mutation ID/body. | 38 tests, typechecks and lint passed at the phase gate. Browser-specific verification completed in Phase 8. |
| 8 — Completion verification | Production-build Chromium suite, PostgreSQL process-restart/fault tests, CI browser steps, setup/contribution documentation and this evidence record. | Final results: 40 unit/DOM tests, 24 PostgreSQL integration tests and 9 Chromium tests passed; lint, all typechecks and all builds passed. |

No phase was advanced while its acceptance tests were failing. Failures were corrected and their relevant gates rerun. Environment restrictions were resolved through normal Windows-account tool execution; no required gate was waived.

## Persistence and data integrity

- PostgreSQL JSONB remains canonical. Browser and server use the same schema extensions; the server also checks semantic constraints, document limits and asset ownership. Reloading saved notes never invokes a model.
- Save/restore lock course then lesson, check the mutation receipt before revision comparison, snapshot old JSON/provenance/assets, update the document/references and insert the receipt in one transaction. Restore always creates a new revision; identical ordinary saves do not create duplicate snapshots.
- Manual creation stores its receipt atomically with revision 1. Concurrent duplicate requests return the same lesson; competing creation and child insertion cannot leave a container owning a lesson.
- Autosave acknowledgements advance only their captured local sequence. New typing is saved afterward against the returned revision. Network ambiguity retains the exact pending request for retry, including across a browser reload.
- A conflict never silently merges or overwrites notes. Explicit overwrite fetches a fresh server revision and still uses CAS. Schema-invalid live editor content pauses saves/navigation and can be downloaded without substituting the prior valid snapshot.
- Drafts contain notes, revisions, sequences and pending save requests, with no credentials. A nonsecret session identifier scopes IndexedDB records per tab so one tab's successful save does not clear another tab's draft.
- Uploaded bytes are complete before a ready database record is committed. Current and historical asset references are updated in content transactions. Historical references prevent deletion even after the image is removed from current notes.
- A database fault injected at receipt insertion verified rollback of the preceding document update and snapshot. Test-only constraints were removed afterward.

## Executed verification

Environment: Windows PowerShell; Node 24.19.0; npm 11.17.0; PostgreSQL 18.4; Playwright Chromium 156.0.8078.4. Tests used the separately initialized `learnspace_test_m2` database on loopback port 55433, not the developer database configured in `.env`.

| Command/check | Actual outcome |
| --- | --- |
| Scheduled `npm.cmd install` commands | Tiptap 3.32.0 core/PM/React, raster/multipart dependencies and test tools installed; lockfile updated; installs reported zero vulnerabilities. Runtime versions are recorded in workspace manifests/lockfile. |
| `npx.cmd playwright install chromium` | Chromium/headless shell and supporting tools downloaded successfully. |
| `npm.cmd run db:migrate` on a newly created isolated test database | Both existing migrations applied successfully from empty. |
| Repeat `npm.cmd run db:migrate`; `npm.cmd run db:status` | No pending migrations; database up to date. |
| `npm.cmd run check` | Passed Prisma validation, lint, tool/workspace typechecks, **40 unit/DOM tests**, and all production builds on the final code. |
| `npm.cmd run test:integration` with TEST_DATABASE_URL | **24 tests passed** across three files, using real PostgreSQL. The script builds shared/API artifacts first for the restart test. |
| `npm.cmd run test:e2e` with TEST_DATABASE_URL | **9 tests passed** against the production-built SPA/API, final run completed in 21.2 seconds. |
| `git diff --check` | Passed; Git reported expected Windows LF/CRLF notices. |
| Architecture/migration diff inspection | No changes to corrected architecture documents, ADR, Prisma schema or existing migration files. |

The nine browser tests exercise:

1. Manual course/topic creation, blank notes, marks, autosave and reload.
2. Typing during a delayed save and navigation flushing the newest text.
3. A committed save whose HTTP acknowledgement is lost, exact request replay and one snapshot.
4. Two-tab stale revision conflict, retained local notes, explicit overwrite and preserved server history.
5. IndexedDB recovery after failed saves/reload, with no automatic draft application.
6. Failed browser-back navigation, staying in the editor, explicit retry and a real beforeunload dialog.
7. Every supported node/mark surviving edit, history preview, N+1 restoration and reload.
8. Upload/preview/insertion, removal from current notes, continued historical image access and UI restoration.
9. A lost restore acknowledgement retried with the identical mutation and no extra revision.

Additional PostgreSQL checks cover ordering/cycles/FKs, atomic CAS, creation/leaf races, no-op receipts, receipt mismatch, reference rollback, upload rejection, course deletion with historical assets, unavailable-database save responses and all-node/image persistence across a real API process restart. Unit tests use deterministic transport failures and an IndexedDB implementation; browser tests additionally exercise real Chromium IndexedDB. No live AI/provider testing was applicable.

Observed issues corrected during this milestone: prerequisite cycles initially surfaced as 500 despite correct DB rollback; an unnecessary upload catch failed lint; fixture extraction needed its helper import; Windows text reads briefly damaged Unicode punctuation in new files; the unload browser test awaited its own unhandled dialog; image deletion needed an explicit node control; read-only state needed an accessibility attribute; tab drafts needed separate ownership; and invalid live structures needed to pause the autosave queue. All final gates passed after correction. The restart test uses built Node output because source-loader startup was restricted in this environment.

## Migrations, files and operational changes

**No new migration was required.** The existing schema already supplies lesson mutations, snapshots, provenance, current/version asset references and relevant PostgreSQL constraints. The two preserved migrations remain:

1. `20261018000100_initial`
2. `20261018000200_credential_metadata`

No `db push`, reset, truncation, destructive migration or modification of learner data was performed. Fixture cleanup targets only test-created IDs; the existing insert-only sample seed remains intact. Temporary test APIs and verification PostgreSQL processes were stopped after verification. Ignored isolated database/image files were retained rather than deleted.

Implementation files are grouped under `apps/api/src/workspace` (tree, lesson, transaction and asset services/routes), `apps/web/src/editor` (editor/history/recovery UI), `apps/web/src/persistence` (queue, IndexedDB and navigation), and `packages/shared/src` (contracts/schema). Tests were added under those modules and `tests/fixtures`, `tests/integration`, `tests/e2e`; root scripts, workspace manifests/lockfile, Playwright configuration, README, CONTRIBUTING and CI were updated. The original dashboard placeholder was replaced by the functional workspace. AI/export package implementations remain empty.

CI now installs Chromium, runs browser tests after production builds, and retains failed browser traces for seven days. GitHub Actions was edited but not run remotely. Test API processes use loopback ports 3101/3102 and separate ignored asset directories.

## Limitations and remaining risks

- Verification was on Windows/Chromium/PostgreSQL 18.4. Docker startup, remote GitHub Actions, Firefox/WebKit, macOS and Linux execution were not performed here. CI is configured for Linux PostgreSQL/Chromium; configuration is not evidence of a remote run.
- Windows sandbox restrictions affected PostgreSQL startup and Playwright process cleanup; their successful runs used normal Windows-account execution. No environment limitation required waiving an acceptance gate.
- IndexedDB and beforeunload are best effort, not crash-proof persistence. Storage denial/eviction, an OS crash, or duplicated tab session-storage identities can limit recovery. A closed tab's draft is not a synchronized offline database. Invalid editor structures remain in memory and raw JSON download until corrected; they are not canonical saved documents.
- Full snapshots/history have no retention policy. Orphan files from cancelled uploads, ambiguous DB failures or course deletion are conservatively retained; automatic GC/reconciliation is intentionally deferred. Back up PostgreSQL and the asset directory together with writers stopped.
- Controls prioritize data integrity: prompts and JSON history/conflict previews are functional but basic. Math displays literal LaTeX, not rendered equations; tables disallow merged cells and provide insertion/text editing rather than a full table-layout toolbar. Course listing currently loads up to 100 courses in the UI; the API supports cursor pagination. A full accessibility/responsive polish audit remains a later release task.
- The browser bundle is about 959 kB minified (about 290 kB gzip); Vite reports the large-chunk advisory and upstream Zod annotation warnings. Builds pass. Bundle splitting is a later optimization.
- No export visitor/runtime was enabled. The existing editor design's per-node conversion contracts and round-trip fixtures remain the basis for the later export milestone. No AI/proposal, chat, authentication or distributed infrastructure was added.
- License selection remains an owner decision before public distribution.

Milestone 2 is complete within its approved manual-workspace scope. Recommended optional Git checkpoint: `feat: implement milestone 2 persistent manual workspace`, excluding the owner's unrelated `docs/MILESTONE_1.md` changes. No commit or push was created. Stop here; Milestone 3 needs separate authorization.
