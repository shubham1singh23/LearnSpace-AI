# Architecture consistency review

Date: 2026-10-18. Scope: every Markdown file under docs/ and root AGENTS.md. Result: core direction retained; documentation interface/dependency gaps corrected. No application code, migrations or runtime tests were implemented. This review is not implementation approval.

| Check | Finding and resolved contract |
|---|---|
| 1. Database/API/frontend alignment | Added explicit manual lesson creation; zero-based tree revisions; nonsecret config revisions and session binding; immutable context provenance; history metadata and replay receipt fields; image-operation insertion save; leaf-only progress and preference inheritance. Final invariants still require real migration tests. |
| 2. Canonical storage | Confirmed Lesson.document JSONB contains complete Tiptap JSON; versions are recovery snapshots, not competing canonical copies. No Markdown/DOCX database mirror. |
| 3. On-demand lessons | Explicit generation action only after opening an ungenerated leaf; GET/prefetch/syllabus/export do not call models. Manual blank notes win over later generation. Initial generation checks leaf identity, unique topic ownership, operation ownership and tree context before commit. |
| 4. Selection-only edits | Removed acceptance-claim lease and unused rebasing. Exact shared fragment transform, unchanged local sequence, captured revision/hash, preview and one isolated immediate save protect the intended selection. Final save independently verifies no unrelated document changes. |
| 5. Model abstraction | Confirmed LangChain text factory with four adapters, capability registry, bounded structured validation and separate image factory. No LangGraph/agent state requirement. |
| 6. API-key management | Environment keys preferred; UI keys are transient input then write-only server-memory secrets. Defined config revision binding, TTL, restart behavior and active-call semantics. No keys in DB/browser persistence/logs/exports. Local OS account remains the trust boundary. |
| 7. Exports from saved data | Confirmed snapshot-only Markdown/DOCX, no model calls. Completed export lease/pin proposal and course-deletion conflict rules; pure conversion package cannot own DB/file lifecycle. Learning-role attrs export all reflection/recall content. |
| 8. MVP plan coverage | Added P01-P11 task/gate traceability, explicit editing controls, pace, learning-role schema and scratch-answer behavior. Upload moved before image round-trip gate. Separate image provider stays required. Unsupported partial structural selections are an explicit MVP limit. |
| 9. Contradictions/complexity | Removed unnecessary acceptance lease and mapping subsystem. Clarified ready/applied/expired operation lifecycle, stable idempotency scope vs active uniqueness, retry linkage, draft commit replay, snapshot provenance, missing export tables, session handling and course-wrap identity. |
| 10. Execution feasibility | Persistence precedes AI, which precedes targeted editing/chat. Upload exists before rich-image acceptance; export pins precede deletion/GC races. Migrations are staged. Seven days are target work packages; fixed-duration completion of all scope is unproven. |

## Decisions retained

React/Tiptap SPA and Express modular monolith; PostgreSQL/Prisma with canonical JSONB and revision-based concurrency; immutable local assets; on-demand generation; server-only LangChain adapters; deterministic bounded context; explicit AI proposals; saved-data export. No microservices, distributed queue, CRDT, vector database, authentication or billing in the local single-learner MVP.

## Remaining risks and limits

- Prisma block remains a logical proposal with supplemental relation/FK instructions; it must be completed and validated against the pinned major before generating migrations. Custom indexes, same-course FKs, cascades, lock order and races need real PostgreSQL tests.
- Shared ProseMirror schema/transform parity and isolated save barriers require browser/server integration tests. Strict staleness rejects useful proposals after unrelated typing, deliberately favoring preservation.
- Text AI initially supports paragraph/heading ranges and whole text blocks, not arbitrary partial table/list/image selections. Export math uses labeled LaTeX in Word, and Markdown rich-table/underline fidelity has documented warnings.
- Schema-valid educational output may still be incorrect. Quality rubric/live model compatibility remain unverified; no guaranteed offline hosted-model access or external fact-checking pipeline.
- Session-only secrets require reentry; malicious local processes are outside the no-auth localhost security boundary. Browser crash recovery remains best effort.
- Full snapshots, asset version references and export leases cost disk/implementation effort. Do not add automatic retention/GC until its reference tests pass.
- Seven days are ambitious for one developer, especially persistence, four-provider integration, and dual-format exports. Extend elapsed time instead of waiving gates.

## Recommended first implementation milestone

After explicit approval, implement roadmap tasks 1-6 only: compatible pinned workspace/toolchain, initial persistence migrations, browser-safe document/contracts baseline, loopback API health/origin validation, minimal React shell, environment validation and CI with PostgreSQL. Acceptance: migrate from empty, validate Prisma, run typecheck/build/tests, verify DB-unavailable readiness and no secrets in browser bundles. Feature-specific operation/chat/export migrations and AI calls come later.

Documentation checks for this review: all local Markdown links resolve, fenced blocks balance, required files remain present, and documentation-only changes are verified. No application test/build/Prisma validation result is claimed.
