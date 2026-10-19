# Contributing

Read [AGENTS.md](AGENTS.md), the [architecture review](docs/ARCHITECTURE_REVIEW.md), and the relevant design before changing behavior. Keep changes within the approved milestone; do not automatically start the next one.

Use Node 24.19.0 and npm 11.17.0. Follow the [README setup](README.md), install with `npm ci`, and keep `package-lock.json` updated when dependencies change. On Windows PowerShell use `npm.cmd` if execution policy prevents `npm.ps1`.

Before a checkpoint:

```sh
npm run db:generate
npm run check
```

Database changes also require migrations against a separate `learnspace_test` database, `npm run db:seed` twice, and `npm run test:integration` with TEST_DATABASE_URL set. Integration tests clean only their own generated fixture IDs. They do not reset or truncate a database. Use a disposable test database even so.

Persistence/editor changes also require `npm run build`, `npx playwright install chromium`, and `npm run test:e2e` with the migrated TEST_DATABASE_URL. Run the integration and browser suites sequentially. Ports 3101 and 3102 are reserved for their owned test APIs. See README for Windows process-permission and Linux browser-dependency notes.

For schema changes use `npm run db:migrate:dev -- --name descriptive_name`, review generated SQL, and add required PostgreSQL checks/indexes/triggers explicitly. Never edit a migration already shared/applied by other contributors. Test both migration-from-empty and upgrades. Prisma cannot represent every custom invariant; do not replace migrations with `db push`.

Keep shared contracts browser-safe; frontend code must not import Prisma, API configuration or server packages. Credentials stay in environment/server memory, never committed/bundled/logged. AI adapters, generation, selection editing and contextual chat reuse the existing durable operation service. Export remains a reserved package. New milestone work requires separate approval.

Chat mandatory tests use deterministic providers. Status SSE is not token streaming. Chat and scratch insertion use isolated manual PUT requests, never AI-edit operation IDs. Preserve old IndexedDB drafts and exact receipt replay when extending recovery. The progress-leaf migration must abort on invalid existing progress data; never bypass its preflight or repair learner records implicitly. Integration/browser suites share workspace configuration and must run sequentially on the same test database.

Report exact checks and outcomes, including skipped verification and platform limitations. Recommend a conventional Git checkpoint after a passing milestone; do not mix unrelated user changes into it. The project license still needs the owner's choice before public distribution.
