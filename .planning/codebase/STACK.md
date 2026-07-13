# Technology Stack

**Analysis Date:** 2026-07-13

## Languages

**Primary:**
- TypeScript - used throughout `src/`, `scripts/`, `tests/` (strict mode via `astro/tsconfigs/strict` in `tsconfig.json`)

**Secondary:**
- SQL - Drizzle-generated migrations in `drizzle/*.sql`
- Astro components (`.astro`) - `src/pages/index.astro` (currently a single placeholder page)

## Runtime

**Environment:**
- Node.js >= 22.12.0 (required by `package.json` `engines`), locally running Node v24.13.0

**Package Manager:**
- pnpm (lockfile `pnpm-lock.yaml` present)
- Workspace config: `pnpm-workspace.yaml` sets `allowBuilds` for `esbuild` and `sharp`
- No `packageManager` field pinned in `package.json`

## Frameworks

**Core:**
- Astro `^7.0.6` - static site generator / framework, config at `astro.config.mjs` (currently default/empty config, no integrations added yet)

**Testing:**
- Vitest `^4.1.10` - test runner, config at `vitest.config.ts`
  - Uses `globalSetup: ['./tests/global-setup.ts']` to run Drizzle migrations against a test database before the suite runs
  - Uses `setupFiles: ['./tests/setup.ts']` to load `dotenv/config` for each test file

**Build/Dev:**
- `tsx` `^4.23.0` - executes TypeScript scripts directly (used for `pnpm import:csv` and ad-hoc script running)
- `dotenv` `^17.4.2` - loads `.env` into `process.env` for scripts, migrations, and tests (not used by the Astro app itself, which relies on Astro's built-in env handling)

## Key Dependencies

**Critical:**
- `drizzle-orm` `^0.45.2` - ORM/query builder for Postgres, schema defined in `src/db/schema/*.ts`
- `drizzle-kit` `^0.31.10` - migration generation/execution CLI (`pnpm db:generate`, `pnpm db:migrate`), config at `drizzle.config.ts`
- `@neondatabase/serverless` `^1.1.0` - Neon serverless Postgres HTTP driver, used in `src/db/client.ts` and `tests/helpers/test-db.ts`
- `csv-parse` `^7.0.1` - CSV parsing for the Artwork Archive import pipeline (`scripts/import/csv-reader.ts`)

**Infrastructure:**
- None yet (no Cloudflare/R2 SDK dependency present despite R2 being the intended file storage target - see INTEGRATIONS.md)

## Configuration

**Environment:**
- Managed via `.env` (present, git-ignored, contents not read per security policy) and `.env.example` (present, documents required var names) at repo root
- Loaded explicitly with `import 'dotenv/config'` in `drizzle.config.ts`, `scripts/import-csv.ts`, and `tests/global-setup.ts`/`tests/setup.ts`
- Required variables (names only):
  - `ART_COLLECTION_POSTGRES` - production/dev Neon Postgres connection string, used by `src/db/client.ts` and `drizzle.config.ts`
  - `ART_COLLECTION_TEST_DB` - separate Neon Postgres connection string for the test suite, used by `tests/helpers/test-db.ts` and `tests/global-setup.ts`

**Build:**
- `astro.config.mjs` - default Astro config, no adapters/integrations configured yet
- `tsconfig.json` - extends `astro/tsconfigs/strict`, includes `.astro/types.d.ts`
- `drizzle.config.ts` - points schema at `./src/db/schema/index.ts`, migrations output to `./drizzle`, dialect `postgresql`

## Platform Requirements

**Development:**
- Node.js >= 22.12.0
- pnpm
- Access to a Neon Postgres database (or compatible Postgres reachable via `@neondatabase/serverless`) for both `ART_COLLECTION_POSTGRES` and `ART_COLLECTION_TEST_DB`
- Local CSV exports expected at `~/art-collection-data/ContactsExport.csv` and `~/art-collection-data/PiecesExport.csv` for `pnpm import:csv` (overridable via `--contacts=` / `--pieces=` flags, see `scripts/import-csv.ts`)

**Production:**
- Intended deployment target: Cloudflare (per `docs/SPEC.md`), with Cloudflare R2 for artwork image/file storage
- No Cloudflare adapter, `wrangler.toml`, or deployment config currently present in the repo - this is a documented intent, not yet implemented

---

*Stack analysis: 2026-07-13*
