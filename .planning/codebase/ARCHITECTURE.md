<!-- refreshed: 2026-07-13 -->
# Architecture

**Analysis Date:** 2026-07-13

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                     Astro Web App (unbuilt)                  │
│                     `src/pages/index.astro`                  │
│         (default Astro scaffold — no data-driven UI yet)     │
└──────────────────────────────┬────────────────────────────────┘
                                │ (not yet wired up)
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                   Data Access Layer (Drizzle)                │
│   `src/db/client.ts`  +  `src/db/schema/*.ts`                │
│   Exposes `db` (NeonHttpDatabase) and typed table schemas     │
└──────────────────────────────┬────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│              Neon Postgres (serverless, HTTP driver)         │
│         Connection string: `ART_COLLECTION_POSTGRES`         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│         CSV Import Pipeline (standalone CLI, offline)         │
│  `scripts/import-csv.ts` → `scripts/import/run-import.ts`     │
│  reads Artwork Archive CSV exports → parses/normalizes →      │
│  upserts into the same Neon DB via `src/db/client.ts`         │
└─────────────────────────────────────────────────────────────┘
```

The repository currently contains two independent subsystems that share the same database schema and client:

1. **The Astro app** (`src/pages/`) — still the default `astro create --template minimal` scaffold. No routes, components, or data fetching have been implemented yet; `src/pages/index.astro` renders static boilerplate only.
2. **The CSV import pipeline** (`scripts/import-csv.ts` and `scripts/import/*`) — a fully implemented, tested, one-shot Node/tsx CLI script that migrates data out of an "Artwork Archive" export (two CSVs: contacts and pieces) into the Postgres schema defined in `src/db/schema/`.

Both subsystems depend on the same Drizzle schema (`src/db/schema/index.ts`) and both can construct a `drizzle-orm/neon-http` client, but the import script builds its own db instance via `src/db/client.ts` at CLI invocation time (not through any Astro request lifecycle).

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Astro entry page | Default landing page (unimplemented) | `src/pages/index.astro` |
| DB client | Constructs the shared Neon/Drizzle client from `ART_COLLECTION_POSTGRES` | `src/db/client.ts` |
| DB schema | Defines all Postgres tables via Drizzle `pgTable` | `src/db/schema/*.ts` |
| Drizzle migrations | Generated SQL migrations + snapshots, source of truth for schema history | `drizzle/*.sql`, `drizzle/meta/*.json` |
| Import CLI entry | Parses CLI args (`--contacts=`, `--pieces=`), invokes the pipeline, prints summary | `scripts/import-csv.ts` |
| Import orchestrator | Sequences contacts import then artworks import, aggregates results | `scripts/import/run-import.ts` |
| CSV reader | Reads raw CSV files into `string[][]` rows | `scripts/import/csv-reader.ts` |
| Row parsers | Convert raw CSV rows into typed, validated records (with warnings/skips) | `scripts/import/parse-contacts.ts`, `scripts/import/parse-pieces.ts` |
| Normalization helpers | Field-level cleaning/coercion (text, booleans, dates, numerics) | `scripts/import/normalize.ts` |
| Import writers | Upsert parsed records into DB tables, resolve foreign keys, maintain join tables | `scripts/import/import-contacts.ts`, `scripts/import/import-artworks.ts` |
| Lookup resolver | `getOrCreate*` helpers for tags/groups/collections (upsert-by-name) | `scripts/import/lookups.ts` |
| Summary reporter | Formats and prints per-table counts, warnings, skipped rows | `scripts/import/summary.ts` |

## Pattern Overview

**Overall:** Thin layered CLI/ETL pipeline sitting alongside a not-yet-built Astro frontend. There is no service/controller/API layer yet — the Astro app and the import script are two separate entry points into the same database.

**Key Characteristics:**
- Schema-first design: Drizzle `pgTable` definitions in `src/db/schema/` are the canonical model; migrations in `drizzle/` are generated from them via `drizzle-kit generate`.
- ETL pipeline uses a strict parse → normalize → import staged pipeline, with each stage returning both data and diagnostic info (`warnings`, `skipped`) rather than throwing.
- Idempotent upserts: all inserts use `.onConflictDoUpdate({ target: <uniqueColumn>, set: values })` keyed on a "source" id (`sourcePieceId`, `sourceContactId`) or unique name (tags/groups/collections), making the import script safely re-runnable.
- Join-table sync pattern: for many-to-many relations (artists, images, files, collections, tags), each import iteration does `delete where parentId = X` then re-insert, so re-running the import fully replaces child rows rather than merging them.
- No API/backend layer exists between the Astro pages and the database yet — when built, it will likely be Astro server endpoints or SSR pages calling `src/db/client.ts` directly (Astro is not configured with an adapter in `astro.config.mjs`, so it currently builds as static output only).

## Layers

**Presentation (Astro pages):**
- Purpose: Will serve as the UI for browsing/managing the art collection.
- Location: `src/pages/`
- Contains: `.astro` page components (currently just `index.astro`, unmodified from the starter template)
- Depends on: Nothing yet (no data fetching implemented)
- Used by: End users via browser

**Data access (Drizzle schema + client):**
- Purpose: Defines and connects to the Postgres data model shared by all consumers
- Location: `src/db/`
- Contains: `client.ts` (Neon HTTP driver + Drizzle instance), `schema/*.ts` (table definitions)
- Depends on: `@neondatabase/serverless`, `drizzle-orm/neon-http`, env var `ART_COLLECTION_POSTGRES`
- Used by: `scripts/import/*` (via relative imports `../../src/db/client`), future Astro pages/endpoints

**Import pipeline (ETL):**
- Purpose: One-time/repeatable migration of legacy Artwork Archive CSV exports into the Postgres schema
- Location: `scripts/import-csv.ts` (entry) + `scripts/import/*.ts` (pipeline modules)
- Contains: CSV reading, row parsing/validation, normalization utilities, DB writers, lookup resolution, summary reporting
- Depends on: `src/db/schema`, `src/db/client`, `csv-parse`
- Used by: Run manually via `pnpm import:csv [--contacts=path] [--pieces=path]`

**Migrations (schema history):**
- Purpose: Version-controlled, ordered SQL migrations generated from the Drizzle schema
- Location: `drizzle/*.sql` + `drizzle/meta/*.json` (snapshots + `_journal.json`)
- Depends on: `drizzle.config.ts` (points at `src/db/schema/index.ts`, outputs to `./drizzle`)
- Used by: `pnpm db:generate` (create new migration from schema diff), `pnpm db:migrate` (apply to `ART_COLLECTION_POSTGRES`), `tests/global-setup.ts` (applies migrations to `ART_COLLECTION_TEST_DB` before the test suite runs)

## Data Flow

### CSV Import Pipeline (primary data flow currently implemented)

1. CLI invoked via `pnpm import:csv` → `scripts/import-csv.ts` (`scripts/import-csv.ts:1`). Loads `dotenv/config`, resolves `--contacts=` / `--pieces=` paths (default `~/art-collection-data/{ContactsExport,PiecesExport}.csv`), imports the shared `db` from `src/db/client.ts`.
2. Calls `runImport({ db, contactsPath, piecesPath })` in `scripts/import/run-import.ts:16`.
3. Contacts phase: `parseCsvFile(contactsPath)` (`scripts/import/csv-reader.ts:13`) → `parseContactsRows()` (`scripts/import/parse-contacts.ts`) produces typed `ContactRecord[]` plus `warnings`/`skipped` → `importContacts(db, records)` (`scripts/import/import-contacts.ts:25`) upserts into `contacts`, resolves/creates `groups`/`tags` via `getOrCreateGroup`/`getOrCreateTag` (`scripts/import/lookups.ts`), and syncs `contactGroups`/`contactTags` join rows. Produces an `idMap: Map<sourceContactId, dbId>` for FK resolution downstream.
4. Pieces phase: `parseCsvFile(piecesPath)` → `parsePiecesRows()` (`scripts/import/parse-pieces.ts`) produces `ArtworkRecord[]` → `importArtworks(db, records, contactsImport.idMap)` (`scripts/import/import-artworks.ts:30`) upserts into `artworks` (resolving `sellerContactId` via the contacts `idMap`), syncs `artworkArtists` (role-ordered by first-listed = `primary`), `artworkImages`, `artworkFiles`, and resolves/syncs `artworkCollections`/`artworkTags` via the same lookup helpers.
5. `runImport` aggregates all per-table `TableImportResult` counts plus flattened warning/skip messages into an `ImportSummary` (`scripts/import/summary.ts`).
6. `printSummary(summary)` renders a `console.table` of per-table processed/skipped/warning counts followed by itemized warning and skip lines.

**State Management:**
- No in-memory application state; the import script is a single-pass, stateless CLI process. The only cross-phase state is the `contactsImport.idMap` used to resolve artist/seller foreign keys when importing artworks.

### Astro Request Path (not yet implemented)

- `astro.config.mjs` uses `defineConfig({})` with no adapter configured, so the project currently targets static output only. No pages read from the database yet.

## Key Abstractions

**Drizzle table schema (`pgTable`):**
- Purpose: Declarative, typed definition of each Postgres table; single source of truth consumed by both the app and `drizzle-kit` for migration generation.
- Examples: `src/db/schema/artworks.ts`, `src/db/schema/contacts.ts`, `src/db/schema/lookups.ts` (tags/groups/collections), `src/db/schema/joins.ts` (all many-to-many join tables), `src/db/schema/artwork-artists.ts` (join table with an extra `role` enum + `sortOrder`), `src/db/schema/artwork-images.ts`, `src/db/schema/artwork-files.ts`.
- Pattern: All tables re-exported from the barrel `src/db/schema/index.ts`, imported elsewhere as `import { artworks, contacts, ... } from '../../src/db/schema'` (or `'./schema'` from within `src/db/`).

**`TableImportResult` / `ImportSummary`:**
- Purpose: Uniform shape (`{ processed, skipped, warnings }`) for reporting the outcome of importing each table; aggregated across all tables into one `ImportSummary` object returned by `runImport`.
- Examples: `scripts/import/import-contacts.ts:8`, `scripts/import/summary.ts:4`.
- Pattern: Every import function returns counts rather than throwing; row-level problems are collected as string messages (`warningMessages`, `skippedMessages`) instead of failing the whole run.

**Normalization result tuples (`{ value, warning }`):**
- Purpose: Field-level parsing functions (`parseDateOrNull`, `parseNumericOrNull`, `parseTimestampOrNull`, `parseCreationYear`, `parseBirthDate`) always return both the coerced value (or `null`) and an optional `ParseWarning`, so callers can accumulate diagnostics without try/catch.
- Examples: `scripts/import/normalize.ts`.
- Pattern: "Parse, don't throw" — malformed input degrades to `null` plus a warning message rather than aborting the import.

**Source ID → DB ID mapping:**
- Purpose: Legacy Artwork Archive CSV exports reference entities by their own integer IDs (`sourceContactId`, `sourcePieceId`, `sourceCurrentLocationId`, `sourcePurchaseLocationId`). The schema preserves these as `unique()` columns on the new tables, and the import pipeline builds `Map<sourceId, newId>` structures (e.g., `idMap` in `ImportContactsResult`) to resolve foreign keys across the two CSV files.
- Examples: `src/db/schema/artworks.ts:16` (`sourcePieceId`), `src/db/schema/contacts.ts:6` (`sourceContactId`), `scripts/import/import-contacts.ts:26` (`idMap`).

## Entry Points

**Astro dev/build:**
- Location: `src/pages/index.astro` (only route), configured via `astro.config.mjs`
- Triggers: `pnpm dev` (background mode per project convention — see `AGENTS.md`/`CLAUDE.md`), `pnpm build`, `pnpm preview`
- Responsibilities: Currently none beyond serving the default Astro scaffold page

**CSV import CLI:**
- Location: `scripts/import-csv.ts`
- Triggers: `pnpm import:csv` (aliases to `tsx scripts/import-csv.ts`), optionally with `--contacts=<path>` / `--pieces=<path>`
- Responsibilities: One-shot migration of Artwork Archive CSV exports into Neon Postgres; safe to re-run (idempotent upserts)

**Drizzle Kit CLI:**
- Location: `drizzle.config.ts` (schema path `src/db/schema/index.ts`, output `./drizzle`)
- Triggers: `pnpm db:generate` (diff schema → new migration file), `pnpm db:migrate` (apply pending migrations to `ART_COLLECTION_POSTGRES`)
- Responsibilities: Schema versioning and migration application

**Test suite bootstrap:**
- Location: `vitest.config.ts` (references `tests/global-setup.ts` and `tests/setup.ts`)
- Triggers: `pnpm test` (`vitest run`)
- Responsibilities: `tests/global-setup.ts` applies all Drizzle migrations to `ART_COLLECTION_TEST_DB` once before the suite runs; `tests/setup.ts` loads `dotenv/config` per test file; `tests/helpers/test-db.ts` provides a `testDb` Drizzle client pointed at the test database for use in `tests/db/*.test.ts` and `tests/import/*.test.ts`.

## Architectural Constraints

- **Threading:** Single-threaded Node.js processes throughout (Astro dev/build process and the standalone `tsx` import script); no worker threads or queues.
- **Global state:** `src/db/client.ts` and `tests/helpers/test-db.ts` each create a module-level singleton Drizzle client on import (`db` / `testDb`), constructed eagerly from `process.env` — importing either module without the corresponding env var set (`ART_COLLECTION_POSTGRES` / `ART_COLLECTION_TEST_DB`) throws immediately at import time.
- **Circular imports:** None observed; `src/db/schema/*.ts` files import from each other in one direction (e.g., `joins.ts` imports `artworks.ts`, `contacts.ts`, `lookups.ts`; nothing imports back from `joins.ts`).
- **No API layer:** There is currently no HTTP API or Astro server endpoint reading from the database — only the Astro static page and the offline CSV import script. Any new backend functionality (e.g., pages that query `artworks`) will be the first consumer of `src/db/client.ts` from within the Astro request lifecycle, which will require choosing/adding an SSR adapter in `astro.config.mjs` if server-rendered data fetching is needed.
- **Sequential, per-row DB writes in the import pipeline:** `importContacts`/`importArtworks` loop over records with `for...of` and `await` each insert/delete individually (not batched), so import performance scales linearly with row count and network round-trips to Neon.

## Anti-Patterns

### Delete-then-reinsert for join tables

**What happens:** Every import pass for a parent row (contact or artwork) deletes all of its child join rows (`contactGroups`, `contactTags`, `artworkArtists`, `artworkImages`, `artworkFiles`, `artworkCollections`, `artworkTags`) and reinserts them from the current CSV state (`scripts/import/import-artworks.ts:127-188`, `scripts/import/import-contacts.ts:81-94`).
**Why it's wrong:** This is safe only because the import script is the sole writer of these join tables. If application code (e.g., a future Astro admin UI) ever writes to these same join tables directly, re-running the CSV import will silently discard those manual changes.
**Do this instead:** If the Astro app later needs to let users edit tags/groups/collections/images directly, either stop using delete-and-reinsert for those specific tables in the import script, or treat the CSV import as strictly one-directional/initial-seed-only and document that re-running it after manual edits is destructive.

### Module-level DB client construction

**What happens:** `src/db/client.ts` throws at import time if `ART_COLLECTION_POSTGRES` is unset, and instantiates the Neon connection eagerly as a module singleton (`src/db/client.ts:7-15`).
**Why it's wrong:** Any file that imports `src/db/client.ts` — including in test contexts or scripts that don't need a real DB connection — will fail immediately unless the env var is present, making the module hard to import for pure unit tests of unrelated logic.
**Do this instead:** Existing tests avoid this by using a separate `tests/helpers/test-db.ts` client pointed at `ART_COLLECTION_TEST_DB` rather than importing `src/db/client.ts` directly in DB-focused tests; continue that separation, and consider lazy client initialization if `src/db/client.ts` needs to be imported in more contexts.

## Error Handling

**Strategy:** Two different strategies depending on layer:
- Fail-fast at startup for missing configuration: `src/db/client.ts`, `drizzle.config.ts`, `tests/helpers/test-db.ts`, and `tests/global-setup.ts` all throw synchronously if their required env var is missing.
- Accumulate-and-report for data-quality issues during import: row-level parsing/normalization problems never throw — they produce `{ value: null, warning }` (see `scripts/import/normalize.ts`) or push onto `warningMessages`/`skippedMessages` arrays that are printed at the end of the run (`scripts/import/summary.ts:31-43`).

**Patterns:**
- Required env vars are checked immediately after obtaining `process.env.<VAR>` and before constructing any client (`src/db/client.ts:7-11`, `drizzle.config.ts:5-7`, `tests/helpers/test-db.ts:6-9`).
- Import-time data problems never abort the run; they are surfaced only in the final `printSummary` output as `[WARN]`/`[SKIP]` lines.

## Cross-Cutting Concerns

**Logging:** No structured logging framework; the import CLI uses `console.table` and `console.log` for its end-of-run summary (`scripts/import/summary.ts`). No logging exists in the Astro app layer yet.
**Validation:** Performed entirely in the row-parsing stage of the import pipeline (`scripts/import/parse-contacts.ts`, `scripts/import/parse-pieces.ts`, `scripts/import/normalize.ts`); no runtime validation library (e.g., zod) is used — coercion/validation is hand-written per field.
**Authentication:** Not present anywhere in the codebase yet (no auth middleware, no session handling, no user model).

---

*Architecture analysis: 2026-07-13*
