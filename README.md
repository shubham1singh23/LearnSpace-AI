# LearnSpace AI

A local-first learning platform under active development. **Milestone 2 implements a persistent manual workspace:** course/topic/prerequisite management, Tiptap notes, raster uploads, sequential autosave, conflict recovery, and version history. AI, chat, exports, and authentication are not implemented.

The workspace loads real courses and their arbitrary nested topic trees. Select a leaf and choose **Create blank notes**. Seeding adds hierarchy/objectives only, with no lesson documents or AI calls. Use **Wrap topic** to add a container above a leaf with notes while retaining its identity.

## Requirements

- Node **24.19.0** (`.nvmrc`) and npm **11.17.0**. Use the lockfile; no global Prisma/Vite install is needed.
- Docker with Compose and a running Docker daemon, or a local PostgreSQL 18 instance.
- The default local ports: web 5173, API 3001, PostgreSQL 5432.

## Local setup

From the repository root:

```sh
npm ci
cp .env.example .env
```

PowerShell: use `Copy-Item .env.example .env`; use `npm.cmd` in place of `npm` if script execution policy blocks `npm.ps1`.

Edit `.env`. Replace the example local development password in **both** POSTGRES_PASSWORD and DATABASE_URL; URL-encode reserved characters in the URL password. These values configure a new local database, not a hosted service. A PostgreSQL Docker volume preserves its original credentials after initialization; changing the environment does not reset an existing database password. Do not delete volumes containing learning data to fix credentials.

```sh
npm run db:up
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open **http://127.0.0.1:5173**. API health: **http://127.0.0.1:3001/api/health**. The Vite proxy keeps browser requests local; use the exact configured WEB_ORIGIN. API_PORT/API_HOST and WEB_ORIGIN are read by development configuration; restart after changes.

For an existing PostgreSQL installation, create a dedicated `learnspace` database and set DATABASE_URL to its loopback connection; skip `db:up`. The application does not migrate or overwrite databases automatically. `db:seed` is repeatable and never rewrites an existing sample course or lesson. No model configuration/key is required for this milestone. Optional AI environment variables are validated but not used for calls.

## Production build on the local machine

```sh
npm run build
```

Set NODE_ENV=production in `.env`, then `npm start`. Open **http://127.0.0.1:3001**. Express serves the built SPA and API from the same origin. `npm start` requires prior client generation and build. The default service is designed for one local learner; remote/multiuser hosting is outside the current security scope.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Build/watch shared contracts, run API and Vite |
| `npm run build` | Build all packages, backend and frontend |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint checks |
| `npm test` / `npm run test:unit` | Contracts, configuration and API boundary tests |
| `npm run test:integration` | Real PostgreSQL tests, requires TEST_DATABASE_URL |
| `npm run test:e2e` | Chromium tests against built SPA/API and TEST_DATABASE_URL |
| `npm run check` | Prisma validation, lint, typecheck, unit tests and builds |
| `npm run db:generate` / `npm run db:validate` | Generate client / validate schema |
| `npm run db:migrate` / `npm run db:status` | Apply committed migrations / inspect status |
| `npm run db:migrate:dev -- --name change_name` | Create a reviewed development migration |
| `npm run db:seed` | Add sample hierarchy without lessons |
| `npm run db:up` / `npm run db:down` | Start PostgreSQL / stop Compose without deleting its volume |

Generate the Prisma client after installation/schema changes, before typechecking/building. Scripts do not assume installation hooks ran. `npm ci` may report pending dependency install-script approvals on npm versions with that policy; use npm's explicit package approvals per local policy if required. No application secret is required for install/generation.

## PostgreSQL integration tests

Create a separate database. With the default Compose service:

```sh
docker compose exec db createdb -U learnspace learnspace_test
```

Use the configured POSTGRES_USER if different. Then set DATABASE_URL and TEST_DATABASE_URL for the test command process to the same loopback `learnspace_test` URL, using your development password. Run:

```sh
npm run db:migrate
npm run db:seed
npm run db:seed
npm run test:integration
```

PowerShell example (replace the password):

```powershell
$env:DATABASE_URL = 'postgresql://learnspace:YOUR_PASSWORD@127.0.0.1:5432/learnspace_test?schema=public'
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run test:integration
Remove-Item Env:DATABASE_URL
Remove-Item Env:TEST_DATABASE_URL
```

Those session environment values override `.env`; removing them restores normal `.env` configuration on the next run. The test runner refuses database names other than `learnspace_test` or `learnspace_test_*`, and fails clearly when unconfigured rather than claiming skipped tests passed. GitHub Actions provisions its own PostgreSQL service, migrates from empty, repeats deploy/seed, then runs all checks/builds. A remote CI run is not implied by local success.

Integration tests compile the API and use loopback port **3102** to verify a real API process restart. Browser tests use production-built files on **3101** and write test image files under ignored `data/milestone2-e2e`. Keep these ports free. Test cleanup removes only fixtures it created; it does not truncate/reset the database. Run integration and browser suites sequentially because the foundation seed test checks database-wide counts.

With TEST_DATABASE_URL still set to the migrated test database:

```sh
npm run build
npx playwright install chromium
npm run test:e2e
```

Linux CI uses `npx playwright install --with-deps chromium`. Windows sandbox restrictions may require normal Windows-account execution for PostgreSQL startup and Playwright process cleanup. Do not point the browser tests at development learning data.

## Health and local security

- `GET /api/health` and `/api/v1/health/ready`: 200 only when required migrations and writable asset storage are ready; otherwise 503 with safe status fields.
- `GET /api/v1/health/live`: process liveness only, independent of PostgreSQL.
- Exact Host/Origin checks reject cross-site access and DNS-rebinding hosts. Unknown endpoints return structured errors; internal errors/connection strings are not returned.
- Hosted provider keys never belong in VITE_* variables, source files or browser persistence. `.env`, dependency caches, generated clients/builds and local data are ignored.
- Canonical lesson documents are JSONB, with schema version and positive revision. Database schema also includes the documented later-feature tables, without implementing those workflows. No acceptance-claim table/endpoint or rebasing subsystem exists.

## Data and recovery

Docker stores PostgreSQL in its named volume; uploaded immutable image files live under `DATA_DIR/assets` (default `data/assets`). Back up PostgreSQL and asset files together. Stop writers while taking a backup until a consistent backup workflow is implemented. `docker compose down` retains the volume; `down -v` destroys it and is not part of normal setup.

Custom migration SQL enforces root/child ordering, same-course parents/dependencies, cycle/leaf guards, JSON document roots, statuses, asset reference integrity, active-operation uniqueness and export lease restrictions. Milestone 2 adds no migrations and preserves both existing migrations unchanged. Course deletion deletes owning content/history before asset rows; file garbage collection remains deferred.

Notes autosave after 750 ms idle, or within five seconds of continuous typing. Only one save is in flight; lost responses retry the identical mutation ID/body. A conflict retains local notes: compare the server copy, download local JSON, then explicitly load the server copy or save local notes against a freshly fetched revision. Navigation flushes all edits or stays on the lesson with recovery choices. Browser unload warns about unsaved work; it does not promise an asynchronous save.

IndexedDB stores best-effort drafts and pending save bodies, scoped per tab by a nonsecret session identifier. Reload offers an explicit recovery choice; resuming a stale draft still requires server revision checks. Browser storage eviction, denied storage, duplicated session-storage identities, or an OS/browser crash can limit recovery. Download JSON before closing a tab with failed saves. Invalid editor structures pause persistence and can be downloaded as live JSON for manual recovery.

Every changed save snapshots the prior revision and its assets. Version restore creates a new revision and retains the replaced state. History is retained indefinitely; images cannot be deleted while current notes or history reference them. Cancelled uploads and deleted courses may leave orphan files until a separately verified garbage collector is implemented. Math is stored and displayed as literal LaTeX; tables are rectangular with no merged cells. History/conflict previews use JSON. These are functional controls, not the final polished interface.

## Project map

```text
apps/web/                 React, Vite, Router, Tailwind, local shadcn/ui components
apps/api/                 Express services, locked transactions, assets and Prisma
packages/shared/          Browser-safe contracts and shared Tiptap/headless schema
packages/ai/              Reserved boundary; no model calls
packages/document-export/ Reserved boundary; no export workflows
prisma/                   Full proposed data model, migrations and syllabus-only seed
tests/integration/        Real PostgreSQL and health verification
tests/e2e/                Production-build Chromium preservation/race tests
docs/                     Architecture, requirements, roadmap and milestone evidence
.github/workflows/        PostgreSQL-backed CI
```

Read [AGENTS.md](AGENTS.md), [architecture review](docs/ARCHITECTURE_REVIEW.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md), and [contribution instructions](CONTRIBUTING.md). Milestone evidence is in [Milestone 2](docs/MILESTONE_2.md). The owner must select a license before open-source distribution. No commit, publication, deployment, or Milestone 3 implementation is automatic.
