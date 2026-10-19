# Milestone 3 — model setup and on-demand generation

Implementation checkpoint: 2026-10-19. Scope is roadmap tasks **12–16**, implemented in the approved nine-phase order. No Milestone 4 work, commit, push, deployment, authentication, chat, image generation or export workflow was added.

## Implemented behavior

- Four server-only LangChain text adapters: OpenAI, Anthropic, Google Gemini and Ollama. All use a common validated adapter and conservative capability registry. Arbitrary model IDs remain configurable; no model catalog or live compatibility claim is implied.
- Environment-backed or eight-hour server-memory session credentials, revision-checked configuration updates, default text configuration, new-course preference defaults and explicit bounded connection testing. Session credentials are cleared from the form immediately and never written into configuration/operation JSON, browser storage or response DTOs.
- Durable PostgreSQL operations with scope/key/body-hash idempotency, immutable nonsecret model snapshots, execution ownership, renewable leases, cancellation, rejection, expiry and explicit retry lineage. Recovery never automatically reruns an interrupted provider call.
- Status-first SSE, reconnect reset events, heartbeat comments and durable polling fallback. Course-scoped metadata discovery is paginated, at most 100 operations per request. A specific recovered regeneration can be reopened through its course activity link.
- Explicit syllabus generation into a validated review draft. Review permits editing structured JSON. Atomic commit is restricted to an unchanged empty tree, assigns server UUIDs, preserves nesting/order/prerequisites, increments tree revision once and records an idempotent committed-tree reference. It creates no lessons.
- An educational compiler maps paragraph, list, code, math, worked example, analogy, reflection and table blocks into existing canonical editor nodes. It assigns fresh block IDs, pairs recall question/answer metadata, labels uncertainty/unverified source claims, and runs final shared Tiptap validation.
- Explicit initial lesson generation only. Concurrent equivalent requests share work; existing saved notes are returned without a model call. Manual creation, changed tree context, cancellation, lost ownership and expired execution prevent delayed creation.
- Regeneration uses saved edited notes and bounded prerequisite context to produce a preview. Acceptance requires explicit confirmation, unchanged local edit sequence/editor identity and server revision/tree checks. It reuses snapshots, mutation receipts and historical asset references, and atomically marks the operation applied.
- Unknown regeneration acknowledgements retain the exact mutation body, pause editing/internal navigation and permit receipt replay. Any local document edit, including undo, invalidates a pending proposal. Previous uploaded images remain accessible through history and restoration.

Creating a course, committing a syllabus, opening a topic and reloading saved notes never generate a lesson. **Create blank notes** remains available independently of model configuration.

## Files changed

| Area | Files |
|---|---|
| Shared contracts | `packages/shared/src/ai-contracts.ts`, `ai-contracts.test.ts`, `index.ts` |
| Model package | `packages/ai/src/adapters.ts`, `transport.ts`, `registry.ts`, `pipelines.ts`, `compiler.ts`, `index.ts`; adapter/compiler/pipeline tests; package manifest and TypeScript configuration |
| API services | `apps/api/src/ai/configuration.ts`, `configuration.test.ts`, `operations.ts`, `context.ts`, `generation.ts`, `router.ts` |
| API integration | `apps/api/src/app.ts`, `server.ts`, `workspace/lesson-service.ts`, `apps/api/package.json` |
| Workspace UI | `apps/web/src/ModelSettings.tsx`, `OperationStatus.tsx`, `Syllabus.tsx`, `InitialGeneration.tsx`, `workspace.tsx`, `api.ts` |
| Editor integration | `apps/web/src/editor/Regeneration.tsx`, `PersistentNotes.tsx`, `NotesEditor.tsx`, `persistence/autosave.ts` |
| PostgreSQL tests | `tests/integration/ai-configuration.test.ts`, `ai-operations.test.ts`, `ai-generation.test.ts`, `operation-restart.test.ts` |
| Browser tests | `tests/e2e/generation.spec.ts`, `model-settings.spec.ts`, `operation-status.spec.ts` |
| Test/build setup | `tests/support/server.ts`, `tsconfig.e2e.json`, `playwright.config.ts`, root `package.json`, `package-lock.json`, `.github/workflows/ci.yml` |
| Setup/evidence | `README.md`, `.env.example`, this report |

The corrected architecture/design documents, existing migrations, and `docs/MILESTONE_1.md` / `docs/MILESTONE_2.md` remain unchanged. Git status was clean at task start; no existing uncommitted user changes were overwritten.

## Provider dependencies and verified capabilities

Pinned direct dependencies: `@langchain/core@1.2.18`, `@langchain/openai@1.6.2`, `@langchain/anthropic@1.5.12`, `@langchain/google@0.2.11`, `@langchain/ollama@1.3.0`, and `zod@4.6.7`. The lockfile records transitive versions. No LangGraph package was introduced.

| Provider | Mandatory verification | Live verification |
|---|---|---|
| OpenAI | Actual LangChain SDK request mapping, authentication header, strict JSON/schema validation, safe failure, cancellation and deadline through fake HTTP transport | Not run |
| Anthropic | Same deterministic adapter checks | Not run |
| Google Gemini | Same checks, including header-based API key transport | Not run |
| Ollama | Same checks, without a hosted credential | Not run |

The registry currently selects **prompt/parse JSON fallback** for all free-form models. Native schema mode, provider token streaming, vision and tool execution are not enabled. Image generation is explicitly unsupported. The registry's 16,384-token context and 8,192-token maximum output are application ceilings, not verified specifications for every user-entered model.

Hosted endpoints are fixed HTTPS origins. Ollama accepts loopback IP origins only, without credentials/query/hash/path; HTTP is permitted only for this local endpoint. Every SDK request passes an origin/method/redirect guard, a 256 KiB request limit and 1 MiB response limit. Model text has a further 512,000-character limit. Output tokens are bounded, input uses a conservative byte-based budget with reserved output/margin, and the transport binds the operation abort signal even when an SDK omits it. Hosted tracing/verbose environment switches are disabled and callbacks are empty.

Connection probes are explicit, potentially paid calls capped at 64 output tokens and 15 seconds. Ordinary text operations have an overall 120-second deadline. Invalid structured output permits one repair with the same captured input; raw invalid output is not echoed into the repair prompt. There is no automatic provider switch or unbounded retry loop.

## API and contract additions

All routes retain existing loopback Host/Origin and JSON protections. Operation starts require a UUID `Idempotency-Key`, now included in allowed preflight headers.

| Route | Behavior |
|---|---|
| GET/PATCH `/api/v1/settings` | Nonsecret defaults; image configuration reference is preserved, image configuration writes remain deferred |
| GET/POST `/api/v1/provider-configurations` | List/create nonsecret text configuration DTOs |
| PUT/DELETE `/api/v1/provider-configurations/:id` | Revision-checked update / remove configuration without deleting learning content |
| POST `/api/v1/provider-configurations/:id/test` | Explicit bounded text/structured connection probe |
| GET `/api/v1/courses/:id/operations` | Bounded course metadata discovery with cursor and limit |
| GET `/api/v1/operations/:id` | Durable safe status and validated result/reference |
| GET `/api/v1/operations/:id/events` | Status SSE; reconnect resets to durable state, no token-replay claim |
| POST `/api/v1/operations/:id/cancel` / `rejections` | Idempotent state transition; completion may already have won |
| POST `/api/v1/courses/:id/syllabus-generations` | Start/replay a syllabus operation |
| POST `/api/v1/courses/:id/syllabus-commits` | Atomic reviewed-draft commit; response identifies committed course revision/topic IDs and draft hash |
| POST `/api/v1/topics/:id/lesson-generations` | Explicit generation, or saved lesson without a model call |
| POST `/api/v1/lessons/:id/regenerations` | Revision-bound replacement preview |
| POST `/api/v1/lessons/:id/regeneration-commits` | Receipt-backed isolated replacement save |

Shared strict Zod schemas cover provider inputs/DTOs/options/capabilities, settings, model snapshots, teaching output, syllabus semantics, operation metadata/results/events, generation requests and commits. Secrets have no field in response or snapshot schemas. Existing ordinary lesson saves still reject targeted AI-operation fields; Milestone 4 acceptance is not enabled.

## Persistence, ownership and recovery

**No migrations were added or changed.** Existing provider/settings/operation/usage tables, active-initial-operation uniqueness, ownership checks, revision constraints and asset/version references were reused. `prisma migrate status` reports both existing migrations applied and the schema up to date. Developer learner data was not used for tests; verification used the existing isolated `learnspace_test_m2` database on loopback port 55433.

Operation start first replays scope/key/hash before resolving credentials. Changed input with the same key fails. A failed key never reruns its call; explicit retry can use a new key and validated `retryOfOperationId`. Admission uses a PostgreSQL advisory transaction lock and checks durable active operations; the local model/probe capacity is two. No background job queue was introduced.

Executions own a token and a 30-second lease, renewed every five seconds. Final writes recheck ownership/status/lease and captured course revision. Cancellation/rejection/acceptance serialize under course, lesson when present, then operation locks. Expired executions are reconciled on operation reads, discovery and new starts; they become interrupted and are not redispatched. Ready previews expire after seven days.

Initial lesson insertion and marking the producing operation applied occur in the same transaction. Regeneration acceptance first replays any existing mutation receipt, then validates revision, ready proposal, ownership and tree context. It snapshots prior content/provenance/assets, writes the new revision, records the receipt and marks applied atomically. Restoring older content still creates a new revision. A repeated accepted mutation returns its original receipt even after later saves.

Context capture is a short consistent course transaction. It includes course/topic information, current saved edited notes for regeneration, and up to three prerequisite excerpts with their choices. Manifests identify lesson revisions and included block IDs. Truncation and omitted images are disclosed. There is no chat history, retrieval/vector subsystem or model-controlled document ID/asset generation.

Each completed provider attempt records duration/outcome. Token counts remain NULL rather than fabricated, and connection probes have no durable usage operation. A process crash or database outage can leave usage unknown even though a provider may have charged for a request.

## Phase evidence

| Phase | Gate evidence |
|---|---|
| 1 — contracts/adapters/registry | Provider SDK fixtures and contract fixtures; initial 52-unit-test suite, lint/typechecks/builds; later expanded cancellation/deadline tests |
| 2 — configuration/onboarding | TTL/revision/credential-leak/restart tests, PostgreSQL configuration API checks, browser password clearing and Milestone 2 browser regressions |
| 3 — operation ownership | PostgreSQL idempotency, changed-input conflict, capacity across runtimes, cancellation/late response and expired-lease tests |
| 4 — transport/UI | PostgreSQL SSE disconnect/reset test; browser fallback, recovery and cancellation; final pagination coverage |
| 5 — syllabus review | Valid/invalid generation, one repair, no topic/lesson writes before commit, structured review validation |
| 6 — syllabus commit | Concurrent replay, nesting/prerequisites, unchanged empty-tree guard, stale/foreign/cancelled commit rejection |
| 7 — compiler/initial generation | All teaching-block editor round-trip, unique IDs/recall metadata, one concurrent initial lesson, saved reopen without AI, manual/tree-change races |
| 8 — regeneration | Atomic snapshots/receipt replay, stale/cancel rejection, browser edit-and-undo invalidation, durable proposal recovery and lost acceptance acknowledgement |
| 9 — full verification | Full unit/PostgreSQL/Chromium suites, real process crash recovery, migration status, builds, source/build checks and this report |

Failures found during implementation were corrected before advancing: incompatible duplicate Zod types exhausted the compiler heap; versions were aligned. PostgreSQL's advisory-lock `void` result needed a serializable projection. Ollama's nonstreaming SDK omitted request cancellation, so the transport now binds it directly. Browser tests caught stale acceptance controls and ambiguous preview labelling; both were corrected.

One targeted PostgreSQL run accidentally overlapped browser verification and conflicted on the test workspace singleton. Only the ten identified test-owned configuration leftovers were removed; the final database/browser runs were repeated sequentially. This is why these suites must not run concurrently against the same test database.

## Actual verification results

Windows, Node 24.19.0 / npm 11.17.0, PostgreSQL 18.4, installed Playwright Chromium. Commands below use PowerShell's `npm.cmd`; `npm` is equivalent on other shells.

| Command/check | Observed result |
|---|---|
| `npm.cmd run db:validate` | Passed, Prisma schema valid |
| `npm.cmd run db:status` with isolated DATABASE_URL | Passed, 2 migrations applied, schema up to date |
| `npm.cmd run lint` | Passed with zero warnings under the lint policy |
| `npm.cmd run typecheck` | Passed across tools and all workspaces |
| `npm.cmd run test:unit` | **63 passed**, 13 files, including all four actual SDK adapters against fake transports |
| `npm.cmd run test:integration` with TEST_DATABASE_URL | **38 passed**, 7 files, real PostgreSQL, including real process restart |
| `npm.cmd run build` | Passed, all packages/API/web production build |
| `npm.cmd run test:e2e` with TEST_DATABASE_URL | **14 passed**, Chromium, production web build and dedicated fake-provider API |
| `git -c core.safecrlf=false diff --check` | Passed |
| Browser-build credential sentinel scan | No test credential sentinels found |
| Protected architecture/migration/Milestone 1/2 diff check | No changes |
| Live provider calls | **Not run**; no personal credentials or paid calls used by mandatory tests |
| Remote GitHub Actions / other browsers | Not run locally; CI configuration updated, no remote success claimed |

`npm.cmd run check` also completed successfully; final targeted/full reruns cover subsequent deadline, recovery and preview-label changes. CI retains fresh-database migration/deploy/seed checks and executes integration/browser suites sequentially. No fresh-clone installation rehearsal or remote CI execution is claimed by this checkpoint.

## Known limitations and remaining risks

- No live model, credential validity, native structured mode, factual accuracy or full educational quality is verified by fake providers or schema validation. User-entered models can have lower actual context/output limits or incompatible generation options. Real use requires deliberate, bounded provider verification and content review.
- This remains a **single local API process**. Credential memory and probe/physical-call admission are process-scoped; multiple API instances are not a supported deployment. PostgreSQL ownership fences content writes, but remote provider abort/billing is best effort.
- Usage token/currency accounting is unavailable; crash-time usage can be unknown. Limits bound requests rather than enforcing a monetary budget. Hosted tracing is disabled; no credential vault is implemented.
- Lease reconciliation is interaction-driven, not an autonomous worker. Recovery may show running until lease expiry. Expired/terminal operation records are retained; retention/garbage collection remains future work.
- Context is bounded and may omit content/images. Large mandatory input can fail the pre-call budget rather than being silently truncated. Session-memory strings cannot be guaranteed physically zeroed by JavaScript garbage collection.
- Syllabus review is JSON-based and review edits are local until committed. History/conflict previews retain their existing functional presentation. UI polish, a model catalog and native provider capability overrides are deferred.
- Build emits existing Zod annotation and large frontend-chunk warnings. These do not fail compilation; bundle splitting remains a later improvement.
- Existing Milestone 2 browser-storage eviction, duplicated-tab recovery identity and orphan-upload/asset-GC limitations remain; no new garbage collector or destructive cleanup was introduced.

## Next bounded milestone

Recommend **Milestone 4, roadmap tasks 17–21 only**, after separate approval: capture/verify selections and block identities; action-specific fragment contracts; preview/reject UI; one shared pure transformation; strict local staleness; isolated immediate acceptance save with server reconstruction, CAS and atomic operation application. Reuse this milestone's provider/configuration/operation/compiler boundaries and existing autosave/history infrastructure. Do not include chat, images, exports or rebasing in that scope.

Recommended optional checkpoint after review: `feat: model onboarding and on-demand course generation`. No commit or push was performed.
