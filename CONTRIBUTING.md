# Contributing

Read [AGENTS.md](AGENTS.md), the [architecture review](docs/ARCHITECTURE_REVIEW.md), and the relevant design before changing behavior. Keep changes within the approved milestone; do not automatically start the next one.

Use Node 24.19.0 and npm 11.17.0. Follow the [README setup](README.md), install with `npm ci`, and keep `package-lock.json` updated when dependencies change. On Windows PowerShell use `npm.cmd` if execution policy prevents `npm.ps1`.

Before a checkpoint:

```sh
npm run db:generate
npm run check
```

Database changes also require migrations against a separate `learnspace_test` database, `npm run db:seed` twice, and `npm run test:integration` with TEST_DATABASE_URL set. Integration tests clean only their own generated fixture IDs. They do not reset or truncate a database. Use a disposable test database even so.

For schema changes use `npm run db:migrate:dev -- --name descriptive_name`, review generated SQL, and add required PostgreSQL checks/indexes/triggers explicitly. Never edit a migration already shared/applied by other contributors. Test both migration-from-empty and upgrades. Prisma cannot represent every custom invariant; do not replace migrations with `db push`.

Keep shared contracts browser-safe; frontend code must not import Prisma, API configuration or server packages. Credentials stay in environment/server memory, never committed/bundled/logged. Reserved AI/export packages intentionally have no runtime implementation yet. Do not add provider SDKs, editor actions, chat, or exports under the foundation milestone.

Report exact checks and outcomes, including skipped verification and platform limitations. Recommend a conventional Git checkpoint after a passing milestone; do not mix unrelated user changes into it. The project license still needs the owner's choice before public distribution.
