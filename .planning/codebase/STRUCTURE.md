# Codebase Structure

**Analysis Date:** 2026-07-13

## Directory Layout

```
art-collection/
├── src/
│   ├── pages/
│   │   └── index.astro       # Only route; default Astro scaffold (unmodified content)
│   └── db/
│       ├── client.ts          # Shared Neon + Drizzle client singleton (`db`, `Db` type)
│       └── schema/
│           ├── index.ts               # Barrel: re-exports every table module
│           ├── artworks.ts            # `artworks` table
│           ├── contacts.ts            # `contacts` table
│           ├── lookups.ts             # `tags`, `groups`, `collections` tables
│           ├── joins.ts               # artwork/contact <-> tag/group/collection join tables
│           ├── artwork-artists.ts     # `artworkArtists` join table + `artworkArtistRole` enum
│           ├── artwork-images.ts      # `artworkImages` table
│           └── artwork-files.ts       # `artworkFiles` table
├── scripts/
│   ├── import-csv.ts           # CLI entry point for `pnpm import:csv`
│   └── import/
│       ├── run-import.ts       # Orchestrates the full contacts→artworks import
│       ├── csv-reader.ts       # Raw CSV file/string → `string[][]`
│       ├── parse-contacts.ts   # Raw rows → typed `ContactRecord[]` (+ warnings/skipped)
│       ├── parse-pieces.ts     # Raw rows → typed `ArtworkRecord[]` (+ warnings/skipped)
│       ├── normalize.ts        # Field-level cleaning/coercion helpers
│       ├── import-contacts.ts  # Upserts contacts + contact join tables
│       ├── import-artworks.ts  # Upserts artworks + artwork join tables
│       ├── lookups.ts          # `getOrCreateTag/Group/Collection` upsert-by-name helpers
│       └── summary.ts          # `ImportSummary` type + `printSummary()` console reporter
├── drizzle/
│   ├── 0000_add_contacts_table.sql       # Generated migration (numbered, sequential)
│   ├── 0001_add_lookup_tables.sql
│   ├── 0002_add_artworks_table.sql
│   ├── 0003_add_artwork_relation_tables.sql
│   ├── 0004_add_join_tables.sql
│   ├── 0005_add_artwork_source_url_columns.sql
│   └── meta/
│       ├── _journal.json             # Migration order/registry used by drizzle-kit
│       └── NNNN_snapshot.json        # Schema snapshot per migration (one per .sql file)
├── tests/
│   ├── setup.ts                # Per-file test setup (loads dotenv)
│   ├── global-setup.ts         # Once-per-run setup: applies Drizzle migrations to test DB
│   ├── helpers/
│   │   └── test-db.ts          # `testDb` client pointed at `ART_COLLECTION_TEST_DB`
│   ├── db/                     # Tests for schema/DB behavior (one file per schema module)
│   │   ├── connection.test.ts
│   │   ├── contacts.test.ts
│   │   ├── lookups.test.ts
│   │   ├── artworks.test.ts
│   │   ├── artwork-relations.test.ts
│   │   ├── artwork-source-url.test.ts
│   │   └── joins.test.ts
│   └── import/                 # Tests for the CSV import pipeline (one file per module)
│       ├── csv-fixture-helpers.ts      # Shared test fixtures/builders for CSV rows
│       ├── csv-reader.test.ts
│       ├── normalize.test.ts
│       ├── parse-contacts.test.ts
│       ├── parse-pieces.test.ts
│       ├── import-contacts.test.ts
│       ├── import-artworks.test.ts
│       ├── lookups.test.ts
│       ├── run-import.test.ts
│       ├── run-import-smoke.test.ts    # End-to-end smoke test of the full pipeline
│       └── summary.test.ts
├── docs/
│   └── superpowers/
│       ├── specs/
│       │   └── 2026-07-12-artwork-database-schema-design.md
│       └── plans/
│           ├── 2026-07-12-artwork-database-schema.md
│           └── 2026-07-12-csv-import-script.md
├── public/                     # Static assets served as-is (favicon, etc.)
├── .planning/
│   └── codebase/                # Generated codebase-map docs (this file's directory)
├── astro.config.mjs             # Astro config (no adapter configured — static output)
├── drizzle.config.ts            # drizzle-kit config (schema path, migrations out dir, DB URL)
├── vitest.config.ts             # Vitest config (references tests/setup.ts, global-setup.ts)
├── tsconfig.json                # Extends `astro/tsconfigs/strict`
├── package.json                 # Scripts: dev/build/preview/test/db:generate/db:migrate/import:csv
├── AGENTS.md                    # Project instructions for coding agents (symlinked as CLAUDE.md)
└── CLAUDE.md -> AGENTS.md        # Symlink so Claude Code picks up the same instructions
```

## Directory Purposes

**`src/pages/`:**
- Purpose: Astro file-based routing root. Every `.astro`/`.md` file here becomes a route.
- Contains: Currently only `index.astro` (unmodified default scaffold).
- Key files: `src/pages/index.astro`

**`src/db/`:**
- Purpose: All database access code — the connection client and the Drizzle schema definitions.
- Contains: `client.ts` (connection/singleton) and `schema/` (table definitions).
- Key files: `src/db/client.ts`, `src/db/schema/index.ts`

**`src/db/schema/`:**
- Purpose: One file per logical table/table-group, all re-exported through `index.ts`. This is the single source of truth for the data model; `drizzle-kit generate` diffs against it to produce new files in `drizzle/`.
- Contains: `pgTable` definitions, `pgEnum` definitions, and `references()` foreign keys.
- Key files: `src/db/schema/artworks.ts` (core artwork fields), `src/db/schema/contacts.ts` (people/artists/sellers), `src/db/schema/lookups.ts` (name-unique lookup tables: tags/groups/collections), `src/db/schema/joins.ts` (plain many-to-many join tables), `src/db/schema/artwork-artists.ts` (join table with extra `role`/`sortOrder` columns), `src/db/schema/artwork-images.ts`, `src/db/schema/artwork-files.ts`.

**`scripts/`:**
- Purpose: Standalone Node/tsx scripts run via `pnpm` scripts, outside the Astro app runtime.
- Contains: `import-csv.ts` (entry point) and `import/` (pipeline modules).
- Key files: `scripts/import-csv.ts`

**`scripts/import/`:**
- Purpose: The CSV → Postgres import pipeline, split by pipeline stage (read → parse → normalize → import → summarize) plus shared lookup logic.
- Contains: One module per pipeline responsibility; each module is independently unit-tested under `tests/import/`.
- Key files: `scripts/import/run-import.ts` (orchestrator), `scripts/import/normalize.ts` (shared field parsers used by both `parse-contacts.ts` and `parse-pieces.ts`)

**`drizzle/`:**
- Purpose: Generated, committed SQL migrations and their schema snapshots — the version history of the Postgres schema.
- Contains: Sequentially numbered `NNNN_description.sql` files and a `meta/` folder with one JSON snapshot per migration plus `_journal.json`.
- Key files: `drizzle/meta/_journal.json` (migration registry consumed by drizzle-kit and by `tests/global-setup.ts`'s `migrate()` call)
- Generated: Yes (via `pnpm db:generate`) — do not hand-edit `.sql` files after they've been applied; add a new migration instead.
- Committed: Yes.

**`tests/`:**
- Purpose: Vitest test suite, split into `db/` (schema/table behavior against a real Postgres test database) and `import/` (pure-function and integration tests for the CSV pipeline).
- Contains: `*.test.ts` files, plus `helpers/` and fixture builders.
- Key files: `tests/global-setup.ts` (runs Drizzle migrations against `ART_COLLECTION_TEST_DB` once before the suite), `tests/helpers/test-db.ts` (per-test DB client), `tests/import/csv-fixture-helpers.ts` (shared CSV row builders for import tests).

**`docs/superpowers/`:**
- Purpose: Historical planning artifacts (spec and implementation plan documents) written before/during past features. Reference material, not consumed by tooling.
- Contains: `specs/` (design docs) and `plans/` (dated implementation plans), one pair per past feature (artwork DB schema, CSV import script).
- Generated: No. Committed: Yes.

**`public/`:**
- Purpose: Static assets served verbatim by Astro (favicon, etc.). No processing.
- Generated: No. Committed: Yes.

**`.planning/`:**
- Purpose: GSD planning/codebase-mapping output directory (this document lives at `.planning/codebase/STRUCTURE.md`).

## Key File Locations

**Entry Points:**
- `src/pages/index.astro`: Only Astro route (default scaffold, not yet built out)
- `scripts/import-csv.ts`: CSV import CLI entry (`pnpm import:csv`)

**Configuration:**
- `astro.config.mjs`: Astro build/dev config (currently empty — no adapter, no integrations)
- `drizzle.config.ts`: drizzle-kit schema path, migrations output dir, DB credentials
- `vitest.config.ts`: Test runner config (setup files, global setup)
- `tsconfig.json`: Extends `astro/tsconfigs/strict`
- `.env` / `.env.example`: Environment variables (never read/quote contents — see forbidden files policy); `.env.example` documents required var names only

**Core Logic:**
- `src/db/schema/index.ts`: Canonical data model (barrel export of all tables)
- `src/db/client.ts`: Shared DB client used by the import script (and, eventually, the Astro app)
- `scripts/import/run-import.ts`: Import pipeline orchestration

**Testing:**
- `tests/db/*.test.ts`: One file per schema module, verifying table constraints/behavior against a real test DB
- `tests/import/*.test.ts`: One file per import-pipeline module, mostly pure-function unit tests plus `run-import-smoke.test.ts` for an end-to-end check
- `tests/helpers/test-db.ts`, `tests/global-setup.ts`, `tests/setup.ts`: Shared test infrastructure

## Naming Conventions

**Files:**
- `kebab-case.ts` throughout `src/db/schema/`, `scripts/import/`, and `tests/` (e.g., `artwork-artists.ts`, `import-contacts.ts`, `csv-fixture-helpers.ts`).
- Test files mirror the module they test with a `.test.ts` suffix in a parallel `tests/` subtree (e.g., `scripts/import/normalize.ts` → `tests/import/normalize.test.ts`; `src/db/schema/contacts.ts` → `tests/db/contacts.test.ts`).
- Drizzle migrations: zero-padded 4-digit sequence number + snake_case description (`0005_add_artwork_source_url_columns.sql`), auto-generated by `drizzle-kit generate` — do not name these manually.
- Planning docs under `docs/superpowers/`: `YYYY-MM-DD-kebab-case-title.md`.

**Directories:**
- Lowercase, singular-or-plural matching content (`schema/`, `import/`, `helpers/`), no special casing conventions beyond standard Node/Astro layout.

**Code identifiers (within schema/import modules):**
- Drizzle table variables: camelCase matching the plural table concept (`artworks`, `contacts`, `artworkArtists`), while the underlying SQL table name (first string arg to `pgTable`) is snake_case (`'artwork_artists'`).
- Column keys: camelCase in TypeScript, snake_case as the SQL column name string (e.g., `sourcePieceId: integer('source_piece_id')`).
- Source-system foreign key columns are consistently prefixed `source*` (`sourcePieceId`, `sourceContactId`, `sourceCurrentLocationId`, `sourcePurchaseLocationId`) to distinguish legacy Artwork Archive IDs from new serial `id` primary keys.

## Where to Add New Code

**New DB table:**
- Add a new file in `src/db/schema/` (e.g., `src/db/schema/exhibitions.ts`), export its `pgTable`, and add `export * from './exhibitions';` to `src/db/schema/index.ts`.
- Run `pnpm db:generate` to produce the corresponding migration in `drizzle/`, then `pnpm db:migrate` to apply it.
- Add a test file in `tests/db/exhibitions.test.ts` following the existing pattern in `tests/db/*.test.ts`.

**New Astro page/route:**
- Add a `.astro` file under `src/pages/` (file path maps directly to the URL route). No existing convention for components yet — per `README.md`, `src/components/` is the idiomatic Astro location once components are introduced.

**New import pipeline stage or CSV source:**
- Add a module to `scripts/import/` following the existing single-responsibility split (reader/parser/normalizer/importer), wire it into `scripts/import/run-import.ts`, and add a matching test in `tests/import/`.

**Utilities:**
- Shared CSV/field-normalization helpers belong in `scripts/import/normalize.ts` (used by both `parse-contacts.ts` and `parse-pieces.ts`).
- No general-purpose `src/lib/` or `src/utils/` directory exists yet; if the Astro app needs shared frontend/backend utilities, introduce one following Astro conventions (e.g., `src/lib/`).

## Special Directories

**`drizzle/`:**
- Purpose: Migration history and schema snapshots
- Generated: Yes (via `drizzle-kit generate`)
- Committed: Yes (required for reproducible migrations across environments)

**`.astro/`:**
- Purpose: Astro's internal build cache/type-generation output (e.g., `.astro/types.d.ts` referenced by `tsconfig.json`)
- Generated: Yes
- Committed: No (should be gitignored; not part of source)

**`node_modules/`, `dist/`:**
- Generated: Yes. Committed: No.

**`docs/superpowers/`:**
- Purpose: Point-in-time planning/spec documents for already-implemented features (database schema, CSV import). Historical reference only — not updated to reflect ongoing drift.
- Generated: No (hand-authored planning docs). Committed: Yes.

---

*Structure analysis: 2026-07-13*
