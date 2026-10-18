# LearnSpace AI engineering instructions

## Current project state and authorization

This repository is in architecture/planning stage. The owner explicitly requested documentation only and must approve before application implementation starts. Do not interpret these plans as implementation authorization. After approval, implement one independently testable task at a time in the order in `docs/IMPLEMENTATION_PLAN.md`. Read existing code and Git status before editing; preserve unrelated user changes. Do not spawn subagents unless the user explicitly requests delegation.

## Read before work

Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/adr/0001-mvp-architecture.md`, and the relevant feature design (`DATABASE`, `API`, `AI_DESIGN`, `EDITOR_DESIGN`, `EXPORT_DESIGN`). Read `docs/RISKS.md` and the current roadmap gate. Update contracts/designs when implementation reveals a justified change; record major tradeoffs in an ADR. Plans describe intended behavior, not proof of implementation.

## Engineering conventions

- Use strict modular TypeScript, explicit interfaces and Zod validation at all external boundaries. Avoid `any`, implicit unsafe casts and catch-all config objects. Dependency versions must be compatible and pinned through the lockfile; do not install unnecessary frameworks.
- Keep React/browser code in `apps/web`; Express/Prisma/filesystem orchestration in `apps/api`; model/prompt logic in `packages/ai`; browser-safe contracts in `packages/shared`; export visitors in `packages/document-export`. No provider SDKs/secrets in browser packages. Export must never import or invoke AI.
- Prefer small services and explicit repository transactions. No unnecessary microservices, Redis, Kafka, Kubernetes, authentication, billing, vector database, agents or LangGraph. Add new infrastructure only for a concrete requirement and a documented decision.
- PostgreSQL `lessons.document` JSONB is the canonical Tiptap document. No canonical Markdown/HTML/DOCX mirror. Add schema versions and export/migration tests for every editor extension. All saved user edits, formatting and images must survive reload.
- Every content mutation uses expected revision, atomic prior-state snapshot, and consistent asset references. Autosave is sequential, retry-idempotent and navigation-aware. Conflicts retain local JSON. Never silently merge/overwrite notes. Restore creates a new revision.
- AI selection edits are proposals, explicitly accepted or rejected. Apply only the captured range/insertion location using Tiptap/ProseMirror transactions. Never use whole-document `setContent` for a targeted edit. Reject stale local selections/revisions and guard the final save on the server.
- Keep AI acceptance an isolated immediate save: no extra acceptance-claim lease, no coalescing new typing into it. Use one shared pure transformation for editor application/server validation and atomically mark the ready operation applied with the content revision. Any intervening document transaction invalidates a pending text proposal; do not build rebasing until that policy changes.
- Initial lessons generate on demand once; reopen loads saved JSON without AI. Duplicate calls and late responses require DB-backed operation ownership and revision/leaf checks. Regeneration is previewed and explicitly confirmed against the current revision.
- Separate chat from notes. Use bounded context from saved edited notes and prerequisites; disclose omitted context. Do not claim schema validation proves factual accuracy. Do not fabricate citations, test results or model capabilities.
- Keep secrets server-side in environment/session memory. UI credential entry may exist transiently in a password input and local POST body only; clear it after submission. No keys in frontend bundles, persistent browser state, query caches, localStorage, logs, exports, committed files or ordinary DB records. UI-persisted credentials need a separately designed encrypted vault; do not improvise plaintext storage. Disable hosted tracing by default.
- Default network binding is loopback with strict Origin/Host rules. Validate document URLs, uploads and provider endpoints. No arbitrary file reads, raw HTML nodes, remote image fetching during export, or filesystem paths supplied by the model. Sanitize filenames and enforce root containment.
- Preserve arbitrary topic nesting/order using a self-reference and consistent tree transactions. Prevent cycles/cross-course references. No implicit destruction when converting a leaf with a lesson to a container.
- Export from saved JSON, include relative image assets, preserve exact tree and ungenerated placeholders, surface conversion limitations, and never silently discard unsupported nodes.

## Verification and progress reporting

Add meaningful unit/integration/E2E tests appropriate to behavior. High-priority coverage: editor transactions, autosave/conflicts, generation races, migration constraints, snapshots/restore, provider failures, assets and both exports. Use real PostgreSQL for database semantics; deterministic fake AI in CI. Live provider tests are opt-in and must not expose keys or incur unbounded cost.

Run available typecheck, lint, relevant tests and builds after changes. Before a milestone checkpoint run its roadmap gate and required checks; do not repeat broad suites without a reason. Report exact commands, observed outcomes, skipped checks and limitations. Never claim tests passed if they were not executed. A Markdown contract review is not an application test. Do not add tests that merely mirror trivial implementation details.

Use clear conventional commit recommendations after each working milestone. Inspect Git diff before a commit; do not commit unrelated files or secrets. Recommend a Git checkpoint if commit authorization is absent. Keep documentation accurate about completed vs planned behavior. Report remaining issues and the next bounded task; wait for approval when explicitly required by the current task. Do not publish/deploy as a side effect of local implementation.
