# ADR 0001: Local modular monolith and canonical editable documents

Date: 2026-10-18. Status: proposed; implementation approval pending. Scope: initial single-learner MVP. Revisit when collaboration, hosted deployment, offline browser operation, or measured workflow needs change.

## Context

The learner must trust that customized notes survive AI operations, navigation, failures, and exports. The stack is largely user-selected; decisions here specify how it fits together and the tradeoffs. Scalability is secondary to understanding, recovery, and straightforward open-source setup.

| Decision | Reason and alternatives | Consequences |
|---|---|---|
| TypeScript npm-workspaces modular monolith | Shares contracts while keeping browser, API, AI and export boundaries explicit. Microservices add distributed failure and deployment costs with no MVP benefit. | One API process; boundaries enforced with imports/tests. Long operations need bounded concurrency and durable DB state. |
| React/Vite/Tailwind/shadcn/Router | Matches requested stack; explicit editor state control and accessible reusable controls. No SSR requirement. | Browser state management must distinguish unsaved/editor/query state. Avoid extra global-state framework until needed. |
| Tiptap/ProseMirror JSON canonical format | Structured selections, transactions, marks and nodes fit editable notes. Markdown/plain text lose editor structure; HTML needs more sanitization and is a weaker transaction model. | Maintain schema/version migrations and explicit export visitors. Paid editor/cloud services must not become a setup requirement. |
| PostgreSQL JSONB + normalized metadata via Prisma | Strong transactions/indexes for revisions, hierarchy and lifecycle; JSONB preserves complete notes. SQLite would simplify setup but conflicts with requested PostgreSQL experience and deployment. | Docker dependency, custom migration SQL for partial/composite constraints, snapshot storage growth. |
| Full-document CAS autosave plus prior-revision snapshots | Simple recovery and testable conflict semantics for one local learner. CRDT/OT would add complexity for collaboration outside scope. | Multi-tab conflicts require user resolution; every write validates base revision. No last-write-wins. |
| LangChain standalone models/runnables | Common prompt/model/structured interfaces support four adapters. Autonomous agents and LangGraph have no concrete state-graph requirement. | Provider schemas/capabilities still differ; adapters and validation remain necessary. |
| Lazy generation, immutable until explicit edits/regeneration | Reduces cost and preserves user control. Eager full-course generation wastes time and introduces stale content. | Per-topic generation lifecycle and duplicate protection required. |
| DB-backed operation leases inside same process | Survives restarts well enough for explicit retry and prevents duplicate application. In-memory-only locks fail across restarts; queue infrastructure is excessive. | Interrupted provider calls may have incurred cost; exactly-once external billing is not guaranteed. No automatic replay after restart. |
| Strict stale-selection rejection | Safer to reject after any intervening edit than to guess target positions. Sophisticated mapping-only acceptance could allow more edits but needs stronger proofs. | Some proposals must be rerun; preserve preview and explain why. |
| One atomic targeted acceptance save | An extra acceptance claim/lease cannot prevent a later save race; shared pure transformation validation plus operation/revision CAS does. | Brief editor commit barrier, no rebasing subsystem, no extra acceptance endpoint; repeat via mutation receipt. |
| Environment/session-memory credentials first | Simple clone-and-run path without inventing an encryption vault. Plain DB keys are unacceptable. | UI secrets are reentered after restart. Persistent encrypted credentials are deferred, not falsely claimed. |
| Deterministic context extraction, no vector store | Current lesson/path/recent turns are adequate for MVP. Embeddings add invalidation and setup burden. | Long notes are excerpted; UI discloses omission; revisit with evidence of retrieval failures. |
| Pure export visitors + docx + archiver | Uses saved JSON, supports exact tree and relative assets. Markdown as canonical or regenerating at export would lose edits. | Explicit unsupported-format warnings, file safety and visual DOCX QA required. |
| Local immutable files with DB references | Avoids database blobs while preserving local ownership. Remote object storage adds accounts/network dependency. | Backup includes both DB and assets; references/pins and GC protect historical/export files. |
| Same-origin loopback service without authentication | Fits personal local scope and avoids account complexity. | Validate Origin/Host and restrict file/provider URLs. Remote/multiuser use needs a new security ADR. |
| Separate image-generation adapter | Vision/text capability does not imply image generation; chat abstraction is insufficient for every provider. | At least one explicit image adapter, separate settings, previews and asset validation; unsupported providers degrade clearly. |

## Rejected shortcuts

No blanket document replacement for selection edits; no API keys in frontend environment variables/localStorage/exports; no plaintext persistent UI credentials; no automatic overwrite on conflict; no saving partial streamed JSON; no unvalidated model responses; no export-triggered generation. These shortcuts violate the product's preservation or accuracy requirements.

## Version and evidence policy

Dependency versions are pinned during the first approved implementation task after checking compatibility. Official references reviewed for this proposal: [LangChain JavaScript models](https://docs.langchain.com/oss/javascript/langchain/models), [Ollama integration](https://docs.langchain.com/oss/javascript/integrations/chat/ollama), [Tiptap concepts](https://tiptap.dev/docs/editor/core-concepts/introduction), [Tiptap setContent](https://tiptap.dev/docs/editor/api/commands/content/set-content), [Prisma transactions](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions), and [docx](https://docx.js.org/). They support library mechanisms; all budgets, leases, application workflows and capability policies are design decisions requiring implementation tests.

Acceptance evidence required: preservation/race tests, real PostgreSQL migration tests, provider adapter fixtures and opt-in smoke tests, all-node export tests, and fresh setup validation. None has run in this planning milestone. Owner approval accepts the proposed direction, not a claim that technology compatibility has already been proven.

## Consistency review amendment

The documentation-only review removed acceptance claims and unused transaction rebasing, added manual lesson creation and document learning-role attrs, made provider configuration revisions/session semantics explicit, and completed export lease/pin storage/deletion rules. Shared document transformation helpers are browser-safe/headless; server validation must use the same transform semantics. Upload support precedes image round-trip acceptance; migrations are staged by feature. The seven-day sequence is dependency-feasible but not a guarantee of seven-day completion. See [review record](../ARCHITECTURE_REVIEW.md) for all ten review checks.
