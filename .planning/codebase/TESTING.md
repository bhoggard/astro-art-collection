# Testing Patterns

**Analysis Date:** 2026-07-13

## Test Framework

**Runner:**
- Vitest 4.1.10 (`vitest` in `package.json` devDependencies)
- Config: `vitest.config.ts` — minimal, just wires global setup and per-test setup:
  ```typescript
  export default defineConfig({
    test: {
      globalSetup: ['./tests/global-setup.ts'],
      setupFiles: ['./tests/setup.ts'],
    },
  });
  ```
- No coverage provider configured (no `@vitest/coverage-v8` / `coverage` block in config).

**Assertion Library:**
- Vitest's built-in `expect` (imported from `'vitest'`), no Chai/Jest-extended add-ons.

**Run Commands:**
```bash
pnpm test               # vitest run — runs the full suite once (package.json script)
pnpm vitest             # equivalent, direct binary invocation
pnpm vitest watch       # watch mode (no dedicated script, run directly)
```
There is no coverage script defined; `pnpm test` maps to `"vitest run"` only (`package.json`).

## Test File Organization

**Location:**
- Tests live in a fully separate top-level `tests/` tree, mirroring the structure of `src/` and `scripts/` rather than co-locating `*.test.ts` next to source files.
  - `scripts/import/*.ts` → `tests/import/*.test.ts`
  - `src/db/schema/*.ts` (collectively) → `tests/db/*.test.ts`
- Shared test-only infrastructure lives directly under `tests/`: `tests/helpers/test-db.ts` (DB client for tests), `tests/global-setup.ts` (migration runner, once per full run), `tests/setup.ts` (per-file setup, currently just loads `dotenv/config`), `tests/import/csv-fixture-helpers.ts` (CSV row builders shared across import tests).

**Naming:**
- `<subject>.test.ts`, matching the source file's base name where a 1:1 mapping exists (`normalize.ts` → `normalize.test.ts`).
- Multi-scenario suites for the same subject are split into separate files by scenario size/purpose rather than one giant file: `run-import-smoke.test.ts` (fast, single-record happy path) vs `run-import.test.ts` (large end-to-end fixture covering every edge case, `30_000`ms timeout).

**Structure:**
```
tests/
├── global-setup.ts       # runs once: connects to ART_COLLECTION_TEST_DB, runs drizzle migrations
├── setup.ts               # runs per test file: loads dotenv
├── helpers/
│   └── test-db.ts         # exports `testDb`, a real drizzle client against the test DB
├── db/                     # schema/DB-integration tests (one file roughly per schema concern)
│   ├── connection.test.ts
│   ├── artworks.test.ts
│   ├── contacts.test.ts
│   ├── artwork-relations.test.ts
│   ├── artwork-source-url.test.ts
│   └── joins.test.ts
└── import/                 # CSV import pipeline tests (one file roughly per module + 2 e2e files)
    ├── csv-fixture-helpers.ts
    ├── csv-reader.test.ts
    ├── normalize.test.ts
    ├── parse-contacts.test.ts
    ├── parse-pieces.test.ts
    ├── lookups.test.ts
    ├── import-contacts.test.ts
    ├── import-artworks.test.ts
    ├── run-import-smoke.test.ts
    └── run-import.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
// tests/import/normalize.test.ts
import { describe, expect, it } from 'vitest';
import { cleanText, parseBoolean, /* ... */ } from '../../scripts/import/normalize';

describe('cleanText', () => {
  it('trims whitespace and returns null for empty strings', () => {
    expect(cleanText('  hello  ')).toBe('hello');
    expect(cleanText('')).toBeNull();
  });
});
```
- One `describe` block per exported function/unit under test, named exactly after the function (`describe('parseDateOrNull', ...)`), not after the file.
- `it(...)` descriptions are written as full behavioral sentences in present tense, starting with a verb: `'trims whitespace and returns null for empty strings'`, `'flags an unparseable date'`, `'rejects an artwork referencing a nonexistent seller contact'`. Avoid vague names like `'works'` or `'test 1'`.
- For DB-integration tests, `describe` is named after the table/subject (`describe('artworks table', ...)`) and each `it` describes a full round-trip scenario, not a single assertion.

**Patterns:**
- No `beforeEach`/`afterEach` hooks are used anywhere in the suite. Setup/teardown is done inline inside each `it`, using `try { ... } finally { ...cleanup... }` so data is always cleaned from the shared test database regardless of pass/fail (see `tests/db/artworks.test.ts:12-44`, `tests/import/run-import.test.ts:136-273`).
- Uniqueness/isolation strategy: rows created by a test use randomized IDs (`Math.floor(Math.random() * 1_000_000_000)`) for `sourcePieceId`/`sourceContactId` so parallel test files never collide on the shared database. Global-uniqueness columns (tag/collection `name`) are further disambiguated with a timestamp suffix: `` `Test Collection ${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}` `` (`tests/import/run-import.test.ts:55-56`) — follow this pattern for any new fixture that inserts into a table with a unique/name constraint.
- Long multi-step end-to-end tests document *why* they need a longer timeout inline as a comment, then pass the timeout as the 3rd argument to `it(...)`: `}, 30_000);` (`tests/import/run-import.test.ts:273`).

## Mocking

**Framework:** None. No `vi.mock`, `vi.fn`, or mocking library is used anywhere in the test suite.

**Approach — real integration testing over mocks:**
- All DB-touching tests run against a real Postgres (Neon) test database via `testDb` (`tests/helpers/test-db.ts`), never a mocked or in-memory DB. The connection string comes from `ART_COLLECTION_TEST_DB` (distinct from the production `ART_COLLECTION_POSTGRES` used by `src/db/client.ts`).
- `tests/global-setup.ts` runs Drizzle migrations (`migrate(db, { migrationsFolder: './drizzle' })`) once before the whole suite so the test DB schema is current.
- CSV import tests write real temp files to disk with `mkdtempSync(join(tmpdir(), 'import-e2e-'))` / `writeFileSync` and feed them through the actual `runImport` pipeline, then clean up with `rmSync(dir, { recursive: true, force: true })` in a `finally` block (`tests/import/run-import.test.ts:58-134`, `256-273`).
- Pure functions with no I/O (`normalize.ts`, `csv-reader.ts`'s `parseCsvContent`) are tested directly with plain inputs/outputs — no mocking needed since there's nothing to isolate.

**What to Mock:** Nothing currently. If a future external HTTP/API integration is added, no existing mocking pattern exists to imitate — establish one deliberately (e.g., `vi.mock`) rather than assuming.

**What NOT to Mock:** The database. This codebase's convention is to test against a real database instance rather than mock the ORM/driver — preserve this when adding new DB-touching tests.

## Fixtures and Factories

**Test Data:**
- CSV fixture rows are built with typed builder functions rather than raw string literals, to keep column-index knowledge in one place (`tests/import/csv-fixture-helpers.ts`):
  ```typescript
  export function piecesRow(options: PieceRowOptions): string {
    const cells = new Array(143).fill('');
    cells[0] = String(options.sourcePieceId);
    cells[1] = options.title ?? '';
    // ...
    return cells.map(csvCell).join(',');
  }
  ```
- `CONTACTS_HEADER` / `PIECES_HEADER` constants provide matching header rows (`PIECES_HEADER` is programmatically generated: `Array.from({ length: 143 }, (_, i) => \`Col${i}\`).join(',')` since the real header has no stable names for every column).
- Comments in the fixture helpers call out CSV export quirks the builder must reproduce exactly (off-by-one field indices, reserved trailing slots) — read these comments before modifying column offsets.

**Location:**
- `tests/import/csv-fixture-helpers.ts` is the single shared fixture module for all import tests; there is no separate `fixtures/` or `factories/` directory. DB-integration tests (`tests/db/*.test.ts`) build their fixture data inline per test rather than via shared factories, since each test's data needs are simple (a single insert or two).

## Coverage

**Requirements:** None enforced. No coverage tool is installed and no threshold is configured.

**View Coverage:**
```bash
# Not configured. To add coverage, install `@vitest/coverage-v8` and add a
# `test.coverage` block to vitest.config.ts.
```

## Test Types

**Unit Tests:**
- Pure-function tests for CSV parsing/normalization logic with no DB or filesystem dependency: `tests/import/normalize.test.ts`, `tests/import/csv-reader.test.ts`, `tests/import/parse-contacts.test.ts`, `tests/import/parse-pieces.test.ts`.

**Integration Tests:**
- DB-integration tests that insert/read/delete against the real test database to verify schema constraints and relations: `tests/db/*.test.ts` (e.g., `tests/db/artworks.test.ts` verifies FK behavior and defaults; `tests/db/connection.test.ts` just verifies `select 1` round-trips).
- Import-pipeline integration tests that combine CSV parsing + DB writes for a single stage: `tests/import/lookups.test.ts`, `tests/import/import-contacts.test.ts`, `tests/import/import-artworks.test.ts`.

**E2E Tests:**
- Full-pipeline tests that write real CSV files to a temp directory and invoke `runImport` end-to-end against the real test database: `tests/import/run-import-smoke.test.ts` (fast single-record smoke test), `tests/import/run-import.test.ts` (comprehensive fixture covering multi-artist artworks, multi-image/file records, blank records, year-only dates, seller resolution, unresolved-artist warnings, and re-run idempotency — run twice in the same test to assert no duplication). No browser/UI E2E framework (Playwright/Cypress) is used; there is no UI yet (`src/pages/index.astro` is the Astro starter default page).

## Common Patterns

**Async Testing:**
```typescript
// Standard async/await, no special vitest async helpers needed.
it('inserts an artwork with a seller contact and reads it back', async () => {
  const [artwork] = await testDb.insert(artworks).values({ /* ... */ }).returning();
  expect(artwork.title).toBe('Test Piece');
});
```

**Error Testing:**
```typescript
// tests/db/artworks.test.ts:51-57
await expect(
  testDb.insert(artworks).values({
    sourcePieceId,
    title: 'Bad Reference',
    sellerContactId: bogusContactId,
  }),
).rejects.toThrow();
```
Use `await expect(promise).rejects.toThrow()` for asserting a DB constraint violation; do not wrap in try/catch with a manual `fail()` call.

**Warning/Non-Fatal-Result Assertions:**
```typescript
// tests/import/normalize.test.ts:66-70
const result = parseDateOrNull('not a date', 'Date Added');
expect(result.value).toBeNull();
expect(result.warning).toEqual({ field: 'Date Added', reason: 'unparseable date "not a date"' });
```
Prefer asserting the full `{ field, reason }` warning object with `toEqual` rather than checking substrings, so a wording regression is caught precisely.

---

*Testing analysis: 2026-07-13*
