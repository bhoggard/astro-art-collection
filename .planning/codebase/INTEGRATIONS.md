# External Integrations

**Analysis Date:** 2026-07-13

## APIs & External Services

**None currently integrated at the code level.** The project is an internal database/import tool at this stage; no outbound third-party API calls exist in `src/` or `scripts/` beyond the database driver below.

## Data Storage

**Databases:**
- Neon (serverless Postgres)
  - Connection (app/migrations): `ART_COLLECTION_POSTGRES` env var, consumed in `src/db/client.ts` and `drizzle.config.ts`
  - Connection (tests): `ART_COLLECTION_TEST_DB` env var, consumed in `tests/helpers/test-db.ts` and `tests/global-setup.ts` (runs Drizzle migrations against this DB before the test suite)
  - Client/driver: `@neondatabase/serverless` `neon()` HTTP client wrapped by `drizzle-orm/neon-http`
  - ORM: `drizzle-orm`, schema defined across `src/db/schema/*.ts` (`artworks.ts`, `contacts.ts`, `lookups.ts`, `joins.ts`, `artwork-artists.ts`, `artwork-images.ts`, `artwork-files.ts`), aggregated in `src/db/schema/index.ts`
  - Migrations: SQL files in `drizzle/*.sql` (0000-0005), managed via `drizzle-kit` (`pnpm db:generate`, `pnpm db:migrate`)

**File Storage:**
- Cloudflare R2 (planned, not yet wired up in code)
  - `src/db/schema/artwork-images.ts` and `src/db/schema/artwork-files.ts` each define an `r2Key` text column intended to reference objects in R2
  - No R2 SDK dependency, upload logic, or credentials currently exist in the codebase - `scripts/import/import-artworks.ts` currently inserts `r2Key: null` for all imported rows (image/file upload to R2 is a future step)
  - `sourceUrl` text columns on the same tables retain the original Artwork Archive-hosted URLs as a fallback/reference until R2 migration happens

**Caching:**
- None

## Authentication & Identity

**Auth Provider:**
- None. No auth-related dependencies, middleware, or session handling found in `src/` (site currently has a single placeholder page, `src/pages/index.astro`, with no auth gating)

## Monitoring & Observability

**Error Tracking:**
- None

**Logs:**
- Plain `console` output only, e.g. import summary printed via `scripts/import/summary.ts` (`printSummary`) invoked from `scripts/import-csv.ts`

## CI/CD & Deployment

**Hosting:**
- Cloudflare (planned per `docs/SPEC.md`) - no adapter (`@astrojs/cloudflare`), `wrangler.toml`, or other Cloudflare deployment config present yet in `astro.config.mjs` or the repo root

**CI Pipeline:**
- None detected (no `.github/workflows`, no other CI config found)

## Environment Configuration

**Required env vars:**
- `ART_COLLECTION_POSTGRES` - Neon Postgres connection string for app/dev/migrations
- `ART_COLLECTION_TEST_DB` - separate Neon Postgres connection string used exclusively by the test suite (`tests/global-setup.ts` runs real migrations against it)

**Secrets location:**
- `.env` at repo root (git-ignored per `.gitignore`; not read here per security policy)
- `.env.example` at repo root documents the variable names/shape for local setup (contents not read; forbidden file per security policy, but its existence confirms a documented env template)

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## Data Import Pipeline (external data source, not a live integration)

This isn't a runtime integration, but is the primary "external" data dependency in the codebase today:

- Source: Artwork Archive CSV exports (`ContactsExport.csv`, `PiecesExport.csv`), described in `docs/SPEC.md`, expected on disk at `~/art-collection-data/` by default
- Entry point: `pnpm import:csv` runs `scripts/import-csv.ts`, which calls `runImport()` from `scripts/import/run-import.ts`
- Pipeline modules: `scripts/import/csv-reader.ts` (parsing via `csv-parse`), `scripts/import/parse-contacts.ts`, `scripts/import/parse-pieces.ts`, `scripts/import/normalize.ts`, `scripts/import/lookups.ts`, `scripts/import/import-contacts.ts`, `scripts/import/import-artworks.ts`, `scripts/import/summary.ts`
- Destination: the Neon Postgres database via the same Drizzle `db` client used by the app (`src/db/client.ts`)

---

*Integration audit: 2026-07-13*
