# Coding Conventions

**Analysis Date:** 2026-07-13

## Naming Patterns

**Files:**
- Kebab-case for all TypeScript files: `import-artworks.ts`, `csv-reader.ts`, `parse-pieces.ts`, `artwork-artists.ts`.
- Test files mirror the source file name with a `.test.ts` suffix, placed under a parallel `tests/` tree rather than co-located: `scripts/import/normalize.ts` → `tests/import/normalize.test.ts`.
- Schema files are named after the table/domain they define: `src/db/schema/artworks.ts`, `src/db/schema/contacts.ts`, `src/db/schema/joins.ts` (junction tables grouped together in one file).
- A barrel file re-exports all schema modules: `src/db/schema/index.ts` uses `export * from './<module>'` for every schema file.

**Functions:**
- camelCase, verb-first: `parseCsvContent`, `parseCsvFile`, `getOrCreateTag`, `getOrCreateGroup`, `getOrCreateCollection`, `importArtworks`, `importContacts`, `runImport`, `printSummary`.
- Parsing helpers that can fail follow a `parseXOrNull` naming convention and return a `{ value, warning }` tuple object rather than throwing: `parseDateOrNull`, `parseNumericOrNull`, `parseTimestampOrNull` (see `scripts/import/normalize.ts`).
- Boolean-returning parsers are named for the specific CSV convention they encode, not generically: `parseLiteralBoolean` (literal `"true"`/`"false"` strings) vs `parseBoolean` (blank = false, anything else = true) in `scripts/import/normalize.ts:16-22`. When adding a new boolean-ish CSV field, pick the parser that matches the source column's actual convention — don't assume one generic `parseBoolean` covers every field.
- Private/internal helpers not meant for cross-module use are declared as unexported `function` (not `export`) at the top of the file, e.g. `emptyResult()` in `scripts/import/import-contacts.ts:21` and `scripts/import/import-artworks.ts:26`, `parseIntOrNull`, `parseImages`, `parseFiles` in `scripts/import/parse-pieces.ts`.

**Variables:**
- camelCase throughout; descriptive names tied to domain vocabulary (`sellerContactId`, `sourcePieceId`, `contactIdMap`, `warningMessages`).
- Result accumulator objects are named `<entity>Result` (`artworksResult`, `artworkArtistsResult`) and mutated in place via `.processed++` / `.warnings++` counters rather than rebuilt immutably — this matches the CSV-import domain's need for running tallies during a long loop.
- Constants are UPPER_SNAKE_CASE when module-level and semantically fixed: `ZERO_WIDTH_SPACE` in `scripts/import/normalize.ts:3`, `CONTACTS_HEADER` / `PIECES_HEADER` in `tests/import/csv-fixture-helpers.ts`.

**Types:**
- PascalCase interfaces, no `I` prefix: `ArtworkRecord`, `ContactRecord`, `ParseWarning`, `RowIssue`, `TableImportResult`, `ImportSummary`.
- Drizzle table column types are inferred, not manually declared; `Db` (the drizzle client type) is exported from `src/db/client.ts:17` as `export type Db = NeonHttpDatabase<typeof schema>;` and imported wherever a function needs the DB handle: `import type { Db } from '../../src/db/client';`.
- Discriminated-union-style literal types are used for small enums: `role: 'primary' | 'additional'` in `scripts/import/import-artworks.ts:117`, narrowed via a type-guard filter (`(id): id is number => id !== null`).

## Code Style

**Formatting:**
- No Prettier/ESLint/Biome config file is present in the repo (`.eslintrc*`, `.prettierrc*`, `eslint.config.*`, `biome.json` all absent). Formatting is enforced only by convention/consistency, not tooling — match the surrounding file's style exactly rather than relying on an auto-formatter.
- Single quotes for strings, trailing commas in multi-line literals, semicolons everywhere, 2-space indentation.
- Long argument lists and object literals are wrapped one-key-per-line when they exceed ~100 characters (see `src/db/schema/artworks.ts`, `scripts/import/import-artworks.ts:53-107`).
- A single-line comment with the relative file path is placed at the top of nearly every source and test file, e.g. `// src/db/client.ts`, `// tests/import/normalize.test.ts`. Follow this when adding new files.

**Linting:**
- No linter configured. `tsconfig.json` extends `astro/tsconfigs/strict`, so type-checking is the primary static-analysis gate (`tsconfig.json:2`). Run `pnpm astro check` (via `pnpm astro -- check` or an editor's TS server) to catch type errors; there is no separate `pnpm lint` script in `package.json`.

## Import Organization

**Order (observed convention, not enforced by tooling):**
1. Node built-ins (`node:fs`, `node:os`, `node:path`) — always with the `node:` protocol prefix.
2. Third-party packages (`vitest`, `drizzle-orm`, `@neondatabase/serverless`, `csv-parse/sync`).
3. Local imports, ordered from most distant to most local (e.g. `../../src/db/client` before `./lookups`), using relative paths exclusively.

**Path Aliases:**
- None configured. All imports use relative paths (`../../src/db/schema`, `../../scripts/import/normalize`). There is no `@/` or `~/` alias in `tsconfig.json` — do not introduce one without updating `tsconfig.json` `paths`.

**Type-only imports:**
- `import type { ... }` is used consistently for type-only imports, kept as a separate `import type` statement even when other named imports come from the same module (e.g. `scripts/import/lookups.ts:2` imports `type { Db }` from `../../src/db/client` separately from value imports elsewhere).

## Error Handling

**Patterns:**
- Two distinct error-handling strategies depending on severity:
  1. **Hard failures** (missing required config) throw immediately at module load time: `src/db/client.ts:9-11` and `tests/helpers/test-db.ts:8-10` both throw `new Error('<VAR> environment variable is not set')` if the connection string env var is missing.
  2. **Soft/recoverable issues** (bad CSV data) never throw — they are collected as structured warnings and returned alongside the parsed result, e.g. `{ value, warning }` from `parseDateOrNull`/`parseNumericOrNull`/`parseTimestampOrNull` (`scripts/import/normalize.ts`), and `{ records, warnings, skipped }` from `parsePiecesRows`/`parseContactsRows`. Warnings/skips are string-templated with row numbers and field names for human-readable output, then surfaced via `printSummary` (`scripts/import/summary.ts`).
- Row-level import failures (e.g., unresolved foreign key lookups) are pushed onto a `warningMessages: string[]` array with a `row <n>: <reason>` format rather than aborting the whole import — see `scripts/import/import-artworks.ts:48` and `run-import.ts:37-39`. When adding new import validation, follow this pattern: collect a warning message and continue, don't throw.
- Database-level constraint violations (e.g., a bad foreign key) are allowed to throw and are asserted directly in tests with `await expect(promise).rejects.toThrow()` (`tests/db/artworks.test.ts:51-57`) rather than pre-validated in application code — the DB is the source of truth for referential integrity.

## Logging

**Framework:** Plain `console` — no logging library.

**Patterns:**
- `console.table()` for the final tallied import summary (`scripts/import/summary.ts:19`).
- `console.log()` for human-readable warning/skip sections, prefixed with `[WARN]` / `[SKIP]` tags (`scripts/import/summary.ts:31-43`).
- No logging inside library/pure functions (`normalize.ts`, `parse-pieces.ts`, `parse-contacts.ts`) — those functions are silent and return data; only the top-level CLI entry (`scripts/import-csv.ts` → `printSummary`) does console output. Keep this separation: business logic returns structured data, the CLI entry point is the only place that prints.

## Comments

**When to Comment:**
- Sparse by default; comments are added only to explain *non-obvious* domain quirks or CSV-format oddities, not to restate code. Examples:
  - `scripts/import/parse-pieces.ts` has no inline comments despite complex column-index logic — instead the field layout is documented implicitly via named constants/interfaces.
  - `tests/import/csv-fixture-helpers.ts:45` explains an off-by-one quirk in the source CSV export format: `// Every real data row has a 45th field: the header's "Date Added" position...`.
  - `tests/import/run-import.test.ts:35-37` explains *why* a large timeout is needed: `// This exercises the full pipeline twice against the real test database...`.
  - `tests/import/run-import.test.ts:51-54` explains *why* names are randomized instead of fixed literals (parallel test-file collisions on globally-unique columns).
- Comments are written as full sentences ending in a period, placed directly above the line/block they explain.

**JSDoc/TSDoc:**
- Not used. Interfaces and functions rely on descriptive names and TypeScript types instead of doc comments. Do not add JSDoc blocks unless the existing file already has them (none currently do).

## Function Design

**Size:** Functions are allowed to be long when they represent a single linear import/transform pass (e.g., `importArtworks` in `scripts/import/import-artworks.ts` is ~170 lines covering one artwork's full upsert + related-table sync). Prefer extracting a helper only when logic is reused (e.g., `emptyResult()`, `parseImages`, `parseFiles`) rather than for line-count reasons alone.

**Parameters:** Multi-parameter functions take positional args when there are 2-3 conceptually ordered params (`importArtworks(db, records, contactIdMap)`), but switch to a single options object when there are 3+ named, independent inputs (`runImport({ db, contactsPath, piecesPath })` in `scripts/import/run-import.ts:16`). Follow this same threshold for new functions.

**Return Values:** Async DB-writing functions return a structured result object summarizing what happened (`TableImportResult { processed, skipped, warnings }`), never `void`, so callers can aggregate into a summary. Parsing functions that can produce non-fatal issues return `{ value, warning }` or `{ records, warnings, skipped }` rather than throwing — see Error Handling above.

## Module Design

**Exports:** Named exports only — no default exports anywhere in `src/` or `scripts/`. Every function, interface, and constant meant for external use is `export`ed individually.

**Barrel Files:** Only `src/db/schema/index.ts` acts as a barrel, re-exporting all table definitions with `export * from './<module>'` so consumers can `import { artworks, contacts, ... } from '../../src/db/schema'` (see `tests/db/artworks.test.ts:5`, `scripts/import/import-artworks.ts:4-11`). `scripts/import/` has no barrel — each module is imported directly by its specific path (`./lookups`, `./normalize`, `./csv-reader`).

## Drizzle Schema Conventions

- Every table uses `serial('id').primaryKey()` as its PK column name `id`.
- Column names are `snake_case` in the DB (first string arg to the column builder) but `camelCase` in the TS property key: `sourcePieceId: integer('source_piece_id')` (`src/db/schema/artworks.ts:16`).
- Foreign keys are declared inline with `.references(() => otherTable.id)`, and the referenced table module is imported directly (e.g., `contacts` imported into `artworks.ts`) — watch for import-order/circular-dependency risk when adding cross-references.
- Junction/join tables live together in one file, `src/db/schema/joins.ts`, each using a composite primary key via `primaryKey({ columns: [...] })` inside the third `pgTable` config-object argument, keyed under a `pk` field.
- Booleans that represent CSV-derived flags always declare `.notNull().default(false)` (e.g. `framed`, `signed`, `isPublic`, `creationDateCirca` in `src/db/schema/artworks.ts`) so imports never need to special-case `null` vs `false`.
- Upserts use `.onConflictDoUpdate({ target: <uniqueColumn>, set: values })` keyed on the CSV source id (`sourcePieceId`, `sourceContactId`) or on `name` for lookup tables (tags/groups/collections), making imports idempotent by design — see `scripts/import/lookups.ts` and `scripts/import/import-artworks.ts:109-113`.

---

*Convention analysis: 2026-07-13*
