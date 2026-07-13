# Codebase Concerns

**Analysis Date:** 2026-07-13

## Tech Debt

**No transactional integrity in import/write paths:**
- Issue: `src/db/client.ts` uses `drizzle-orm/neon-http` (the Neon HTTP driver), which sends each query as an independent HTTP request and does **not** support `db.transaction()`. All multi-step writes in the import pipeline (delete-then-insert sequences) run as separate, non-atomic statements.
- Files: `src/db/client.ts`, `scripts/import/import-artworks.ts` (lines ~109-188), `scripts/import/import-contacts.ts` (lines ~69-94), `scripts/import/lookups.ts`
- Impact: A crash, network blip, or thrown error partway through processing a row can leave an artwork updated but its images/files/artists/tags deleted-and-not-reinserted (or vice versa), silently corrupting relational data. This risk grows as the import script is re-run periodically against updated CSV exports.
- Fix approach: Switch to `drizzle-orm/neon-serverless` (WebSocket/Pool driver) for scripts that need transactions, and wrap each per-row write sequence (`delete` + `insert` for `artworkArtists`, `artworkImages`, `artworkFiles`, `artworkCollections`, `artworkTags`) in `db.transaction()`. Keep the HTTP driver for read-mostly Astro page rendering where transactions aren't needed.

**Destructive delete-then-recreate pattern for join/relation tables:**
- Issue: On every import run, `importArtworks` and `importContacts` unconditionally `delete` all rows in `artwork_artists`, `artwork_images`, `artwork_files`, `artwork_collections`, `artwork_tags`, `contact_groups`, and `contact_tags` for a given parent row, then reinsert from the CSV.
- Files: `scripts/import/import-artworks.ts:127,140,155,173,184`, `scripts/import/import-contacts.ts:81,90`
- Impact: Any data added directly in the database (e.g., manually via a future admin UI, or via `r2Key` values populated by a separate R2 upload step referenced by `artwork_images.r2Key`/`artwork_files.r2Key`) will be wiped the next time the CSV importer runs, because rows are deleted by `artworkId` and reinserted with `r2Key: null` (see `import-artworks.ts:146,163`). There is no merge/preserve logic for `r2Key`.
- Fix approach: Before deleting, read existing rows to preserve `r2Key` (match by `sourceUrl` or sort order) or switch to an upsert-by-natural-key strategy instead of delete-all-then-insert.

**No cascading deletes on foreign keys:**
- Issue: Every foreign key in the schema is created with `ON DELETE no action` (confirmed in generated SQL).
- Files: `drizzle/0003_add_artwork_relation_tables.sql:28-31`, `drizzle/0004_add_join_tables.sql:25-32`, and the corresponding Drizzle schema definitions in `src/db/schema/artwork-artists.ts`, `src/db/schema/artwork-images.ts`, `src/db/schema/artwork-files.ts`, `src/db/schema/joins.ts`
- Impact: Deleting an `artwork` or `contact` row will fail with a Postgres FK violation unless the application manually deletes all dependent rows first (in the correct order across 7 tables). There is no code path today that does this, so any future "delete artwork" feature will need custom cleanup logic or will error.
- Fix approach: Add `onDelete: 'cascade'` (or `'restrict'` with explicit app-level cleanup, if intentional) to the relevant `references()` calls, then generate a migration.

**Hardcoded CSV column-index parsing with no header validation:**
- Issue: `parsePiecesRows` and `parseContactsRows` read fields by fixed numeric column index (e.g., `row[76]` for primary image URL, `row[142]` onward for file triples, `row[59]` for seller contact id) rather than by header name lookup.
- Files: `scripts/import/parse-pieces.ts` (whole file, especially `parseImages` lines 103-117 and `parseFiles` lines 119-133), `scripts/import/parse-contacts.ts` (whole file)
- Impact: If Artwork Archive changes its CSV export column order, adds/removes a column, or the malformed-header issue noted in `docs/SPEC.md:7` shifts columns unexpectedly, the importer will silently read the wrong field into the wrong column with no error — e.g., a phone number could be imported as an email, or an image URL as a caption. There is no assertion that the header row matches the expected schema before parsing data rows.
- Fix approach: Parse the header row into a name→index map and look up columns by name (already parsed as an array by `csv-reader.ts`), or add a startup assertion that compares actual headers against an expected list and fails fast on mismatch.

**Sequential per-row, per-relation database round-trips in import:**
- Issue: `importArtworks` and `importContacts` process records one at a time in a `for...of` loop with multiple `await`s per row (one delete + one insert per relation table, plus one round-trip per tag/collection/group via `getOrCreateTag`/`getOrCreateCollection`/`getOrCreateGroup` in `scripts/import/lookups.ts`).
- Files: `scripts/import/import-artworks.ts:43-189`, `scripts/import/import-contacts.ts:31-95`, `scripts/import/lookups.ts:6-37`
- Impact: For a collection of hundreds/thousands of artworks each with several tags/collections/images, this produces many sequential HTTP round-trips to Neon, making full re-imports slow. No batching or caching of already-resolved tag/collection/group names within a run.
- Fix approach: Cache resolved tag/collection/group ids in an in-memory `Map` keyed by name for the duration of a run (avoiding repeat `getOrCreate` round-trips), and batch inserts across rows where possible.

**No database indexes beyond primary keys and unique constraints:**
- Issue: None of the schema files (`src/db/schema/*.ts`) define secondary indexes. Foreign key columns like `artwork_images.artwork_id` and `artwork_files.artwork_id` have no index at all (only an unrelated `id` serial primary key).
- Files: `src/db/schema/artwork-images.ts`, `src/db/schema/artwork-files.ts`, `src/db/schema/artworks.ts`
- Impact: Currently low risk given small data volume, but any future page that queries "all images for artwork X" or filters artworks by `type`/`medium`/`isPublic` will do sequential scans as the collection grows.
- Fix approach: Add indexes on `artwork_images.artwork_id`, `artwork_files.artwork_id`, and any columns used in `WHERE`/`ORDER BY` clauses once query patterns are known (e.g., `artworks.isPublic`, `artworks.type`).

## Known Bugs

No reproducible functional bugs were identified in the current code (the import pipeline has extensive test coverage in `tests/import/`). The items below are latent risks rather than confirmed bugs:

**Silent artist/seller reference loss on unresolved contact ids:**
- Symptoms: If a piece row references an artist or seller `sourceContactId` that doesn't exist in the contacts CSV/idMap, the importer logs a warning and proceeds with `null`/omission rather than failing the row.
- Files: `scripts/import/import-artworks.ts:44-51` (seller), `:118-126` (artists)
- Trigger: A `PiecesExport.csv` row referencing a contact id absent from `ContactsExport.csv` (e.g., due to partial/out-of-sync exports).
- Workaround: Check `summary.warningMessages` output after every import run (`scripts/import/summary.ts`) — nothing currently automates alerting on these warnings.

## Security Considerations

**Database credentials in `.env`, unvalidated at multiple entry points:**
- Risk: `ART_COLLECTION_POSTGRES` (app) and `ART_COLLECTION_TEST_DB` (tests) are read directly from `process.env` with only an existence check, no format/host validation.
- Files: `src/db/client.ts:7-11`, `tests/helpers/test-db.ts`, `tests/global-setup.ts`
- Current mitigation: `.env` is git-ignored (`.gitignore`); `.env.example` exists as a template.
- Recommendations: None urgent — this is a low-traffic internal tool. Ensure `ART_COLLECTION_TEST_DB` never points at the same database as `ART_COLLECTION_POSTGRES` in any shared environment, since `tests/global-setup.ts` runs migrations against it automatically on every test run.

**No authentication/authorization layer exists yet:**
- Risk: `src/pages/index.astro` is still the unmodified Astro starter template — there is no rendered application, no auth, and no access control implemented yet. The `artworks.isPublic` boolean column exists in the schema (`src/db/schema/artworks.ts:45`) implying a future public/private split, but no query or route currently enforces it.
- Files: `src/pages/index.astro`, `src/db/schema/artworks.ts:45`
- Current mitigation: None — not yet a concern since no public-facing pages exist.
- Recommendations: When building pages that read `artworks`, filter by `isPublic` at the query layer (not just in the UI) before this becomes a real information-disclosure risk.

## Performance Bottlenecks

**CSV import round-trip volume (see Tech Debt above):**
- Problem: Sequential per-row, per-relation writes over HTTP to Neon.
- Files: `scripts/import/import-artworks.ts`, `scripts/import/import-contacts.ts`, `scripts/import/lookups.ts`
- Cause: No batching, no in-memory caching of lookup ids, no transaction batching.
- Improvement path: See Tech Debt section — cache lookups, batch inserts, and/or switch to a pooled connection for bulk import.

## Fragile Areas

**CSV parsing pipeline (`scripts/import/parse-pieces.ts`, `scripts/import/parse-contacts.ts`):**
- Files: `scripts/import/parse-pieces.ts`, `scripts/import/parse-contacts.ts`, `scripts/import/normalize.ts`
- Why fragile: Relies entirely on fixed column positions and hand-tuned offsets (e.g., `parseImages` assumes primary image lives at columns 76-77 and up to 30 additional image pairs start at column 78; `parseFiles` assumes file triples start at column 142). Any change to the source export format breaks this silently rather than erroring loudly (see Tech Debt: no header validation).
- Safe modification: When touching these files, add/update fixture-based tests in `tests/import/parse-pieces.test.ts` and `tests/import/parse-contacts.test.ts` using the shared fixture builders in `tests/import/csv-fixture-helpers.ts`, and cross-check column offsets against a real current export before changing indices.
- Test coverage: Good — `tests/import/parse-pieces.test.ts` and `tests/import/parse-contacts.test.ts` cover many edge cases (malformed dates, delimited lists, image/file parsing), but tests encode the same assumed column positions as the implementation, so a real-world header/column drift would not be caught by these tests alone.

**Date/timestamp normalization heuristics (`scripts/import/normalize.ts`):**
- Files: `scripts/import/normalize.ts:32-103`
- Why fragile: `parseDateOrNull`, `parseTimestampOrNull`, `parseCreationYear`, and `parseBirthDate` each implement their own ad hoc regex/fallback parsing logic (e.g., bare 4-digit years are approximated to January 1st: `normalize.ts:93-97`). Malformed or unexpected date formats fall through to JavaScript's lenient `Date` constructor, which can silently misinterpret ambiguous formats (e.g., `MM/DD/YY` vs `DD/MM/YY`).
- Safe modification: Add explicit test cases in `tests/import/normalize.test.ts` for any new date format encountered in real export data before relaxing/changing the regexes.
- Test coverage: `tests/import/normalize.test.ts` exists and covers the documented cases.

## Scaling Limits

**Neon HTTP driver connection model:**
- Current capacity: Fine for a personal/family art collection (low hundreds of artworks, based on `docs/SPEC.md` scope).
- Limit: The `neon-http` driver issues one HTTP request per query with no connection pooling or transaction batching, which will not scale well to bulk operations across thousands of rows or high page-render concurrency.
- Scaling path: Move to `drizzle-orm/neon-serverless` with a pooled `Pool` for write-heavy paths (import scripts) while keeping `neon-http` for simple, low-latency reads in Astro pages.

## Dependencies at Risk

No dependencies show obvious end-of-life or abandonment risk at this time. Notable version facts:
- `astro` `^7.0.6` — major version 7 is current at time of writing; no legacy/deprecated API usage detected in `astro.config.mjs` or `src/pages/index.astro`.
- `drizzle-orm` `^0.45.2` / `drizzle-kit` `^0.31.10` — both pre-1.0, so breaking changes between minor versions are possible; pin/verify carefully before upgrading.
- `@neondatabase/serverless` `^1.1.0` — actively maintained; driver choice (http vs serverless/Pool) is a design decision, not a dependency risk per se (see Tech Debt above).

## Missing Critical Features

**No rendered application yet:**
- Problem: `src/pages/index.astro` is the default Astro starter page (`<h1>Astro</h1>`) — there are no pages that read from `artworks`/`contacts` and render the collection.
- Blocks: The site cannot be used to browse or showcase the art collection until frontend pages/components are built. (Expected at this stage of the project per `docs/superpowers/specs/2026-07-12-artwork-database-schema-design.md:12-14`, which explicitly scopes frontend pages, image upload, and Cloudflare deployment to later phases — not a defect, but a significant gap for anyone picking up this codebase expecting a working site.)

**R2 image upload pipeline not implemented:**
- Problem: `artwork_images.r2Key` and `artwork_files.r2Key` columns exist in the schema (`src/db/schema/artwork-images.ts:10`, `src/db/schema/artwork-files.ts:12`) but are always inserted as `null` by the importer (`scripts/import/import-artworks.ts:146,163`). Images/files currently only have `sourceUrl` pointing at Artwork Archive's third-party CDN (`assets.artworkarchive.com`).
- Blocks: Any production site cannot yet self-host artwork images/files on Cloudflare R2 as specified in `docs/SPEC.md:15`; it would currently depend on a third party's asset hosting remaining available, which is not a sustainable long-term dependency for a permanent collection site.

## Test Coverage Gaps

**No tests exercise mid-import failure/partial-write scenarios:**
- What's not tested: There is no test that simulates a thrown error mid-way through `importArtworks`'s per-row relation writes (e.g., after deleting `artwork_images` but before the insert succeeds) to confirm behavior under partial failure.
- Files: `tests/import/import-artworks.test.ts`, `scripts/import/import-artworks.ts`
- Risk: Given the non-transactional writes described above, a real production failure mode (partial data loss) has no regression test guarding against it.
- Priority: Medium — directly tied to the top Tech Debt item; a fix there should come with a corresponding test.

**No tests cover header/column-position drift in CSV parsing:**
- What's not tested: `tests/import/parse-pieces.test.ts` and `tests/import/parse-contacts.test.ts` build fixture rows using the same fixed indices as the implementation (`tests/import/csv-fixture-helpers.ts`), so a test cannot currently detect if the assumed column layout no longer matches a real Artwork Archive export.
- Files: `tests/import/csv-fixture-helpers.ts`, `scripts/import/parse-pieces.ts`, `scripts/import/parse-contacts.ts`
- Risk: Silent misimport of real-world data if the export format changes; no test would fail.
- Priority: Medium — recommend adding a snapshot test against a small anonymized real export sample, or header-name validation (see Tech Debt) as the actual fix.

**No tests for FK-violation-on-delete behavior:**
- What's not tested: Since no application code currently deletes `artworks` or `contacts` rows, there are no tests confirming what happens (or should happen) on delete given `ON DELETE no action` constraints.
- Files: `tests/db/artworks.test.ts`, `tests/db/contacts.test.ts`
- Risk: Low today (no delete feature exists), but will need coverage as soon as any admin/delete UI is built.
- Priority: Low (until a delete feature is planned).

---

*Concerns audit: 2026-07-13*
