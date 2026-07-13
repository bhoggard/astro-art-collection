# CSV Import Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and test a script that imports the two Artwork Archive CSV exports (`ContactsExport.csv`, `PiecesExport.csv`) into the existing Drizzle/Neon schema, handling the exports' real data-quality quirks and safely re-runnable via upsert.

**Architecture:** Pure parsing/normalization modules (no DB) feed table-specific import modules that take an injected Drizzle `Db` instance — never importing the real client directly, so every module is testable against the project's test database. A thin CLI entrypoint (`scripts/import-csv.ts`) is the only file that touches the real `ART_COLLECTION_POSTGRES` client. `contacts`/`artworks` upsert by their source id; lookup tables (`tags`/`groups`/`collections`) upsert by name; all join/relation tables use delete-then-reinsert per parent row, since they represent "current membership of a set" and must handle removals, not just additions.

**Tech Stack:** TypeScript, `csv-parse`, `tsx`, Drizzle ORM, Vitest, the project's existing Neon test database.

## Global Constraints

- Dev/prod DB connection string: `ART_COLLECTION_POSTGRES`. Test DB: `ART_COLLECTION_TEST_DB`. Tests must never touch `ART_COLLECTION_POSTGRES` — every module under `scripts/import/` takes `db: Db` as a parameter; only `scripts/import-csv.ts` imports `src/db/client.ts`'s `db` value.
- This plan is build + test only. No task runs the import against `ART_COLLECTION_POSTGRES` or the real 906/510-row CSVs — all tests use small hand-built fixtures against `ART_COLLECTION_TEST_DB`.
- Node >=22.12.0, pnpm, ESM (`"type": "module"`).
- Contacts CSV: every data row has 45 fields against a 44-column header. Fields 0-42 map directly to the header (`Contact Id` … `Pinterest URL`); field 43 (header's `Date Added` position) is always blank; the real date-added value is the row's actual last field, i.e. `row[row.length - 1]`.
- Pieces CSV: indices 0-141 map directly to the header for all rows. `row.slice(142)` is the `Additional Files` payload: length ≤ 1 means zero files, otherwise it's a multiple of 3 — chunk into `(name, notes, url)` triples.
- Pieces booleans (`Framed`, `Signed`, `Date is Circa`, `Public`): blank = false, any non-empty value = true. Contacts booleans (`Artist`, `Appraiser`): literal `'true'`/`'false'` strings.
- `Artist Id(s)` (Pieces) is comma-delimited; index 0 is always the primary artist, the rest are additional artists.
- `Creation Date` (Pieces) is almost always a bare year, but must tolerate `'YYYY-MM'` by extracting the leading 4 digits.
- `Birth Date` (Contacts) may be a bare year (approximate to `YYYY-01-01`, with a warning) or a full ISO date.

---

## Task 1: Migration — `sourceUrl` columns on `artwork_images`/`artwork_files`

**Files:**
- Modify: `src/db/schema/artwork-images.ts`
- Modify: `src/db/schema/artwork-files.ts`
- Test: `tests/db/artwork-source-url.test.ts`

**Interfaces:**
- Consumes: nothing new (extends the existing `artworkImages`/`artworkFiles` tables from the merged schema).
- Produces: `artworkImages.sourceUrl` and `artworkFiles.sourceUrl` (both nullable `text` columns). Task 5's `import-artworks.ts` writes to these columns.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/artwork-source-url.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { artworkFiles, artworkImages, artworks } from '../../src/db/schema';

describe('artwork_images/artwork_files sourceUrl column', () => {
  it('stores sourceUrl with r2Key left null', async () => {
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);

    try {
      const [artwork] = await testDb
        .insert(artworks)
        .values({ sourcePieceId, title: 'Source URL Test Piece' })
        .returning();

      const [image] = await testDb
        .insert(artworkImages)
        .values({
          artworkId: artwork.id,
          sourceUrl: 'https://assets.artworkarchive.com/image/upload/example.jpg',
          isPrimary: true,
          sortOrder: 0,
        })
        .returning();

      const [file] = await testDb
        .insert(artworkFiles)
        .values({
          artworkId: artwork.id,
          name: 'Certificate',
          sourceUrl: 'https://assets.artworkarchive.com/image/upload/example.pdf',
          sortOrder: 0,
        })
        .returning();

      expect(image.sourceUrl).toBe('https://assets.artworkarchive.com/image/upload/example.jpg');
      expect(image.r2Key).toBeNull();
      expect(file.sourceUrl).toBe('https://assets.artworkarchive.com/image/upload/example.pdf');
      expect(file.r2Key).toBeNull();
    } finally {
      await testDb.delete(artworkImages).where(eq(artworkImages.artworkId, (await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, sourcePieceId)))[0]?.id ?? -1));
      await testDb.delete(artworkFiles).where(eq(artworkFiles.artworkId, (await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, sourcePieceId)))[0]?.id ?? -1));
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- artwork-source-url`

Expected: FAIL — TypeScript error, `sourceUrl` does not exist on the insert values type (or, if that's not caught first, a Postgres error that column `"source_url"` does not exist).

- [ ] **Step 3: Add the columns**

```typescript
// src/db/schema/artwork-images.ts
import { boolean, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { artworks } from './artworks';

export const artworkImages = pgTable('artwork_images', {
  id: serial('id').primaryKey(),
  artworkId: integer('artwork_id')
    .notNull()
    .references(() => artworks.id),
  r2Key: text('r2_key'),
  sourceUrl: text('source_url'),
  caption: text('caption'),
  sortOrder: integer('sort_order'),
  isPrimary: boolean('is_primary').notNull().default(false),
});
```

```typescript
// src/db/schema/artwork-files.ts
import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { artworks } from './artworks';

export const artworkFiles = pgTable('artwork_files', {
  id: serial('id').primaryKey(),
  artworkId: integer('artwork_id')
    .notNull()
    .references(() => artworks.id),
  name: text('name'),
  notes: text('notes'),
  r2Key: text('r2_key'),
  sourceUrl: text('source_url'),
  sortOrder: integer('sort_order'),
});
```

- [ ] **Step 4: Generate and apply the migration to the dev database**

Run: `pnpm db:generate --name=add_artwork_source_url_columns && pnpm db:migrate`

Expected: a new migration file `drizzle/0005_add_artwork_source_url_columns.sql` with two `ALTER TABLE ... ADD COLUMN "source_url" text;` statements; `db:migrate` reports success against `ART_COLLECTION_POSTGRES`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- artwork-source-url`

Expected: PASS — Vitest's `globalSetup` applies the same migration to `ART_COLLECTION_TEST_DB` automatically.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/artwork-images.ts src/db/schema/artwork-files.ts \
  tests/db/artwork-source-url.test.ts drizzle
git commit -m "feat: add sourceUrl column to artwork_images and artwork_files"
```

---

## Task 2: Script infrastructure — CSV reader, normalization helpers, `Db` type

**Files:**
- Modify: `package.json` (add `csv-parse` dependency, `tsx` dev dependency)
- Modify: `src/db/client.ts` (add `Db` type export)
- Create: `scripts/import/csv-reader.ts`
- Create: `scripts/import/normalize.ts`
- Test: `tests/import/csv-reader.test.ts`
- Test: `tests/import/normalize.test.ts`

**Interfaces:**
- Produces: `parseCsvContent(content: string): string[][]` and `parseCsvFile(filePath: string): string[][]` from `csv-reader.ts`.
- Produces: `ParseWarning { field: string; reason: string }`, and from `normalize.ts`: `cleanText(value): string | null`, `parseLiteralBoolean(value): boolean`, `parseBoolean(value): boolean`, `parseDelimited(value): string[]`, `parseDateOrNull(value, field): { value: string | null; warning: ParseWarning | null }`, `parseTimestampOrNull(value, field): { value: Date | null; warning: ParseWarning | null }`, `parseNumericOrNull(value, field): { value: string | null; warning: ParseWarning | null }`, `parseCreationYear(value): { value: number | null; warning: ParseWarning | null }`, `parseBirthDate(value): { value: string | null; warning: ParseWarning | null }`. Tasks 3-5 import all of these.
- Produces: `Db` type from `src/db/client.ts` — `NeonHttpDatabase<typeof schema>`. Tasks 4-6 use this as the parameter type for every DB-touching function.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add csv-parse
pnpm add -D tsx
```

- [ ] **Step 2: Write the failing tests for `csv-reader.ts`**

```typescript
// tests/import/csv-reader.test.ts
import { describe, expect, it } from 'vitest';
import { parseCsvContent } from '../../scripts/import/csv-reader';

describe('parseCsvContent', () => {
  it('parses a simple CSV into an array of string arrays', () => {
    const content = 'Id,Name\n1,Alice\n2,Bob\n';

    const rows = parseCsvContent(content);

    expect(rows).toEqual([
      ['Id', 'Name'],
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
  });

  it('tolerates rows with more fields than the header (relax_column_count)', () => {
    const content = 'Id,Name\n1,Alice,extra,fields\n';

    const rows = parseCsvContent(content);

    expect(rows).toEqual([
      ['Id', 'Name'],
      ['1', 'Alice', 'extra', 'fields'],
    ]);
  });

  it('treats an embedded newline inside a quoted field as part of one row', () => {
    const content = 'Id,Notes\n1,"line one\nline two"\n2,"single line"\n';

    const rows = parseCsvContent(content);

    expect(rows).toEqual([
      ['Id', 'Notes'],
      ['1', 'line one\nline two'],
      ['2', 'single line'],
    ]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- csv-reader`

Expected: FAIL — cannot find module `'../../scripts/import/csv-reader'`.

- [ ] **Step 4: Implement `csv-reader.ts`**

```typescript
// scripts/import/csv-reader.ts
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

export function parseCsvContent(content: string): string[][] {
  return parse(content, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][];
}

export function parseCsvFile(filePath: string): string[][] {
  return parseCsvContent(readFileSync(filePath, 'utf-8'));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- csv-reader`

Expected: PASS (3 tests).

- [ ] **Step 6: Write the failing tests for `normalize.ts`**

```typescript
// tests/import/normalize.test.ts
import { describe, expect, it } from 'vitest';
import {
  cleanText,
  parseBirthDate,
  parseBoolean,
  parseCreationYear,
  parseDateOrNull,
  parseDelimited,
  parseLiteralBoolean,
  parseNumericOrNull,
  parseTimestampOrNull,
} from '../../scripts/import/normalize';

describe('cleanText', () => {
  it('trims whitespace and returns null for empty strings', () => {
    expect(cleanText('  hello  ')).toBe('hello');
    expect(cleanText('')).toBeNull();
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });

  it('strips zero-width spaces and collapses internal whitespace', () => {
    expect(cleanText('hello​​world')).toBe('helloworld');
    expect(cleanText('too    many   spaces')).toBe('too many spaces');
  });
});

describe('parseLiteralBoolean', () => {
  it('matches the Contacts CSV literal true/false convention', () => {
    expect(parseLiteralBoolean('true')).toBe(true);
    expect(parseLiteralBoolean('false')).toBe(false);
    expect(parseLiteralBoolean('')).toBe(false);
    expect(parseLiteralBoolean(undefined)).toBe(false);
  });
});

describe('parseBoolean', () => {
  it('matches the Pieces CSV blank=false/any-value=true convention', () => {
    expect(parseBoolean('yes')).toBe(true);
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('')).toBe(false);
    expect(parseBoolean(undefined)).toBe(false);
  });
});

describe('parseDelimited', () => {
  it('splits on comma, trims, and drops empty pieces', () => {
    expect(parseDelimited('Male Artists, Female Artists')).toEqual(['Male Artists', 'Female Artists']);
    expect(parseDelimited('Single Value')).toEqual(['Single Value']);
    expect(parseDelimited('')).toEqual([]);
    expect(parseDelimited(undefined)).toEqual([]);
  });
});

describe('parseDateOrNull', () => {
  it('passes through a full ISO date unchanged with no warning', () => {
    expect(parseDateOrNull('2025-07-27', 'Date Added')).toEqual({ value: '2025-07-27', warning: null });
  });

  it('returns null with no warning for an empty value', () => {
    expect(parseDateOrNull('', 'Date Added')).toEqual({ value: null, warning: null });
    expect(parseDateOrNull(undefined, 'Date Added')).toEqual({ value: null, warning: null });
  });

  it('flags an unparseable date', () => {
    const result = parseDateOrNull('not a date', 'Date Added');
    expect(result.value).toBeNull();
    expect(result.warning).toEqual({ field: 'Date Added', reason: 'unparseable date "not a date"' });
  });
});

describe('parseTimestampOrNull', () => {
  it('parses a "YYYY-MM-DD HH:MM:SS" timestamp', () => {
    const result = parseTimestampOrNull('2024-11-13 10:20:32', 'Last Updated');
    expect(result.warning).toBeNull();
    expect(result.value?.toISOString().slice(0, 19)).toBe('2024-11-13T10:20:32');
  });

  it('returns null with no warning for an empty value', () => {
    expect(parseTimestampOrNull('', 'Last Updated')).toEqual({ value: null, warning: null });
  });
});

describe('parseNumericOrNull', () => {
  it('passes through a valid number as a string', () => {
    expect(parseNumericOrNull('2500.0', 'Purchase Price')).toEqual({ value: '2500.0', warning: null });
  });

  it('flags an unparseable number', () => {
    const result = parseNumericOrNull('abc', 'Purchase Price');
    expect(result.value).toBeNull();
    expect(result.warning).toEqual({ field: 'Purchase Price', reason: 'unparseable number "abc"' });
  });

  it('returns null with no warning for an empty value', () => {
    expect(parseNumericOrNull('', 'Purchase Price')).toEqual({ value: null, warning: null });
  });
});

describe('parseCreationYear', () => {
  it('extracts a bare 4-digit year', () => {
    expect(parseCreationYear('2003')).toEqual({ value: 2003, warning: null });
  });

  it('extracts the leading year from a year-month value', () => {
    expect(parseCreationYear('2017-06')).toEqual({ value: 2017, warning: null });
  });

  it('flags a value with no leading year', () => {
    const result = parseCreationYear('circa');
    expect(result.value).toBeNull();
    expect(result.warning).toEqual({ field: 'Creation Date', reason: 'unparseable creation date "circa"' });
  });

  it('returns null with no warning for an empty value', () => {
    expect(parseCreationYear('')).toEqual({ value: null, warning: null });
  });
});

describe('parseBirthDate', () => {
  it('approximates a bare year to January 1st, with a warning', () => {
    const result = parseBirthDate('1974');
    expect(result.value).toBe('1974-01-01');
    expect(result.warning).toEqual({ field: 'Birth Date', reason: 'bare year "1974" approximated to January 1' });
  });

  it('passes through a full ISO date unchanged with no warning', () => {
    expect(parseBirthDate('1976-05-02')).toEqual({ value: '1976-05-02', warning: null });
  });

  it('returns null with no warning for an empty value', () => {
    expect(parseBirthDate('')).toEqual({ value: null, warning: null });
  });

  it('flags an unparseable birth date', () => {
    const result = parseBirthDate('sometime in the 70s');
    expect(result.value).toBeNull();
    expect(result.warning).toEqual({ field: 'Birth Date', reason: 'unparseable birth date "sometime in the 70s"' });
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm test -- normalize`

Expected: FAIL — cannot find module `'../../scripts/import/normalize'`.

- [ ] **Step 8: Implement `normalize.ts`**

```typescript
// scripts/import/normalize.ts

const ZERO_WIDTH_SPACE = /\u200B/g;

export interface ParseWarning {
  field: string;
  reason: string;
}

export function cleanText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = value.replace(ZERO_WIDTH_SPACE, '').trim().replace(/\s+/g, ' ');
  return cleaned === '' ? null : cleaned;
}

export function parseLiteralBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export function parseBoolean(value: string | undefined): boolean {
  return Boolean(value && value.trim() !== '');
}

export function parseDelimited(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

export function parseDateOrNull(
  value: string | undefined,
  field: string,
): { value: string | null; warning: ParseWarning | null } {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return { value: null, warning: null };
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return { value: trimmed.slice(0, 10), warning: null };
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return { value: null, warning: { field, reason: `unparseable date "${trimmed}"` } };
  }
  return {
    value: parsed.toISOString().slice(0, 10),
    warning: { field, reason: `date "${trimmed}" did not match YYYY-MM-DD; parsed via fallback` },
  };
}

export function parseTimestampOrNull(
  value: string | undefined,
  field: string,
): { value: Date | null; warning: ParseWarning | null } {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return { value: null, warning: null };
  const parsed = new Date(trimmed.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) {
    return { value: null, warning: { field, reason: `unparseable timestamp "${trimmed}"` } };
  }
  return { value: parsed, warning: null };
}

export function parseNumericOrNull(
  value: string | undefined,
  field: string,
): { value: string | null; warning: ParseWarning | null } {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return { value: null, warning: null };
  if (!Number.isFinite(Number(trimmed))) {
    return { value: null, warning: { field, reason: `unparseable number "${trimmed}"` } };
  }
  return { value: trimmed, warning: null };
}

export function parseCreationYear(
  value: string | undefined,
): { value: number | null; warning: ParseWarning | null } {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return { value: null, warning: null };
  const match = trimmed.match(/^(\d{4})/);
  if (!match) {
    return { value: null, warning: { field: 'Creation Date', reason: `unparseable creation date "${trimmed}"` } };
  }
  return { value: Number(match[1]), warning: null };
}

export function parseBirthDate(
  value: string | undefined,
): { value: string | null; warning: ParseWarning | null } {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return { value: null, warning: null };
  if (/^\d{4}$/.test(trimmed)) {
    return {
      value: `${trimmed}-01-01`,
      warning: { field: 'Birth Date', reason: `bare year "${trimmed}" approximated to January 1` },
    };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { value: trimmed, warning: null };
  }
  return { value: null, warning: { field: 'Birth Date', reason: `unparseable birth date "${trimmed}"` } };
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm test -- normalize`

Expected: PASS (all `normalize.test.ts` cases).

- [ ] **Step 10: Add the `Db` type export**

```typescript
// src/db/client.ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const connectionString = process.env.ART_COLLECTION_POSTGRES;

if (!connectionString) {
  throw new Error('ART_COLLECTION_POSTGRES environment variable is not set');
}

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });

export type Db = NeonHttpDatabase<typeof schema>;
```

- [ ] **Step 11: Run the full suite to confirm nothing broke**

Run: `pnpm test`

Expected: PASS — every existing test plus the new `csv-reader`/`normalize` tests.

- [ ] **Step 12: Commit**

```bash
git add package.json pnpm-lock.yaml src/db/client.ts scripts/import/csv-reader.ts \
  scripts/import/normalize.ts tests/import/csv-reader.test.ts tests/import/normalize.test.ts
git commit -m "feat: add CSV reader and normalization helpers for import script"
```

---

## Task 3: `parse-contacts.ts` and `parse-pieces.ts`

**Files:**
- Create: `scripts/import/parse-contacts.ts`
- Create: `scripts/import/parse-pieces.ts`
- Test: `tests/import/parse-contacts.test.ts`
- Test: `tests/import/parse-pieces.test.ts`

**Interfaces:**
- Consumes: everything from `scripts/import/normalize.ts` (Task 2).
- Produces: `RowIssue { row: number; reason: string }`, `ContactRecord` (full shape below), `ParseContactsResult { records: ContactRecord[]; warnings: RowIssue[]; skipped: RowIssue[] }`, `parseContactsRows(rows: string[][]): ParseContactsResult`. `ArtworkRecord` (full shape below), `ParsePiecesResult { records: ArtworkRecord[]; warnings: RowIssue[]; skipped: RowIssue[] }`, `parsePiecesRows(rows: string[][]): ParsePiecesResult`. Task 4 consumes `ContactRecord`/`parseContactsRows`; Task 5 consumes `ArtworkRecord`/`parsePiecesRows`; Task 6 consumes both top-level functions; Task 7's fixtures are shaped to match these exactly.

- [ ] **Step 1: Write the failing tests for `parse-contacts.ts`**

```typescript
// tests/import/parse-contacts.test.ts
import { describe, expect, it } from 'vitest';
import { parseContactsRows } from '../../scripts/import/parse-contacts';

const HEADER = [
  'Contact Id', 'Title', 'First Name', 'Last Name', 'Email', 'Secondary Email', 'Job Title',
  'Company Name', 'Work Phone', 'Phone', 'Mobile Phone', 'Website', 'Spouse First', 'Spouse Last',
  'Birth Date', 'Death Date', 'Nationality', 'Address1', 'Address2', 'City', 'State', 'Zip',
  'Country', 'Secondary Address1', 'Secondary Address2', 'Secondary City', 'Secondary State',
  'Secondary Zip', 'Secondary Country', 'Appraiser', 'Artist', 'Artist Piece Count', 'Groups',
  'Tags', 'Bio', 'Notes', 'Location', 'Location Id', 'Facebook URL', 'Instagram URL',
  'Twitter URL', 'LinkedIn URL', 'Pinterest URL', 'Date Added',
];

function contactsRow(overrides: Record<number, string>): string[] {
  const row = new Array(44).fill('');
  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value;
  }
  // Every real data row has a 45th field (the phantom column at index 43 is
  // always blank; the real date-added value is the actual last field).
  row.push(row[43]);
  row[43] = '';
  return row;
}

describe('parseContactsRows', () => {
  it('maps a well-formed artist row, including the phantom-column date offset', () => {
    const row = contactsRow({
      0: '1053986',
      2: 'Melissa',
      3: 'Brown',
      14: '1974',
      16: 'American',
      30: 'true',
      32: 'Female Artists',
      39: 'https://www.instagram.com/boogiebrowntown',
      44: '2025-04-27',
    });

    const { records, warnings, skipped } = parseContactsRows([HEADER, row]);

    expect(skipped).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceContactId: 1053986,
      firstName: 'Melissa',
      lastName: 'Brown',
      birthDate: '1974-01-01',
      nationality: 'American',
      isArtist: true,
      groups: ['Female Artists'],
      instagramUrl: 'https://www.instagram.com/boogiebrowntown',
      dateAdded: '2025-04-27',
    });
    expect(warnings).toEqual([{ row: 2, reason: 'bare year "1974" approximated to January 1' }]);
  });

  it('maps a non-artist company contact with no birth date', () => {
    const row = contactsRow({
      0: '1104177',
      2: 'Zero Art Fair',
      30: 'false',
      44: '2025-07-27',
    });

    const { records, warnings } = parseContactsRows([HEADER, row]);

    expect(records[0]).toMatchObject({
      sourceContactId: 1104177,
      firstName: 'Zero Art Fair',
      isArtist: false,
      birthDate: null,
      groups: [],
      tags: [],
    });
    expect(warnings).toEqual([]);
  });

  it('skips a row with a missing Contact Id', () => {
    const row = contactsRow({ 2: 'No Id Here' });
    row[0] = '';

    const { records, skipped } = parseContactsRows([HEADER, row]);

    expect(records).toEqual([]);
    expect(skipped).toEqual([{ row: 2, reason: 'missing/invalid Contact Id ""' }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- parse-contacts`

Expected: FAIL — cannot find module `'../../scripts/import/parse-contacts'`.

- [ ] **Step 3: Implement `parse-contacts.ts`**

```typescript
// scripts/import/parse-contacts.ts
import { cleanText, parseBirthDate, parseDateOrNull, parseDelimited, parseLiteralBoolean } from './normalize';

export interface RowIssue {
  row: number;
  reason: string;
}

export interface ContactRecord {
  rowNumber: number;
  sourceContactId: number;
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  secondaryEmail: string | null;
  jobTitle: string | null;
  companyName: string | null;
  workPhone: string | null;
  phone: string | null;
  mobilePhone: string | null;
  website: string | null;
  birthDate: string | null;
  deathDate: string | null;
  nationality: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  secondaryAddress1: string | null;
  secondaryAddress2: string | null;
  secondaryCity: string | null;
  secondaryState: string | null;
  secondaryZip: string | null;
  secondaryCountry: string | null;
  isArtist: boolean;
  bio: string | null;
  notes: string | null;
  location: string | null;
  sourceLocationId: number | null;
  instagramUrl: string | null;
  dateAdded: string | null;
  groups: string[];
  tags: string[];
}

export interface ParseContactsResult {
  records: ContactRecord[];
  warnings: RowIssue[];
  skipped: RowIssue[];
}

export function parseContactsRows(rows: string[][]): ParseContactsResult {
  const records: ContactRecord[] = [];
  const warnings: RowIssue[] = [];
  const skipped: RowIssue[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;
    const sourceContactIdRaw = row[0]?.trim() ?? '';
    const sourceContactId = Number(sourceContactIdRaw);

    if (sourceContactIdRaw === '' || !Number.isFinite(sourceContactId)) {
      skipped.push({ row: rowNumber, reason: `missing/invalid Contact Id "${sourceContactIdRaw}"` });
      continue;
    }

    const birthDate = parseBirthDate(row[14]);
    if (birthDate.warning) warnings.push({ row: rowNumber, reason: birthDate.warning.reason });

    const deathDate = parseDateOrNull(row[15], 'Death Date');
    if (deathDate.warning) warnings.push({ row: rowNumber, reason: deathDate.warning.reason });

    const dateAdded = parseDateOrNull(row[row.length - 1], 'Date Added');
    if (dateAdded.warning) warnings.push({ row: rowNumber, reason: dateAdded.warning.reason });

    const sourceLocationIdRaw = row[37]?.trim() ?? '';
    const sourceLocationId = sourceLocationIdRaw !== '' && Number.isFinite(Number(sourceLocationIdRaw))
      ? Number(sourceLocationIdRaw)
      : null;

    records.push({
      rowNumber,
      sourceContactId,
      title: cleanText(row[1]),
      firstName: cleanText(row[2]),
      lastName: cleanText(row[3]),
      email: cleanText(row[4]),
      secondaryEmail: cleanText(row[5]),
      jobTitle: cleanText(row[6]),
      companyName: cleanText(row[7]),
      workPhone: cleanText(row[8]),
      phone: cleanText(row[9]),
      mobilePhone: cleanText(row[10]),
      website: cleanText(row[11]),
      birthDate: birthDate.value,
      deathDate: deathDate.value,
      nationality: cleanText(row[16]),
      address1: cleanText(row[17]),
      address2: cleanText(row[18]),
      city: cleanText(row[19]),
      state: cleanText(row[20]),
      zip: cleanText(row[21]),
      country: cleanText(row[22]),
      secondaryAddress1: cleanText(row[23]),
      secondaryAddress2: cleanText(row[24]),
      secondaryCity: cleanText(row[25]),
      secondaryState: cleanText(row[26]),
      secondaryZip: cleanText(row[27]),
      secondaryCountry: cleanText(row[28]),
      isArtist: parseLiteralBoolean(row[30]),
      bio: cleanText(row[34]),
      notes: cleanText(row[35]),
      location: cleanText(row[36]),
      sourceLocationId,
      instagramUrl: cleanText(row[39]),
      dateAdded: dateAdded.value,
      groups: parseDelimited(row[32]),
      tags: parseDelimited(row[33]),
    });
  }

  return { records, warnings, skipped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- parse-contacts`

Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing tests for `parse-pieces.ts`**

```typescript
// tests/import/parse-pieces.test.ts
import { describe, expect, it } from 'vitest';
import { parsePiecesRows } from '../../scripts/import/parse-pieces';

function piecesRow(overrides: Record<number, string>, extraFileFields: string[] = []): string[] {
  const row = new Array(143).fill('');
  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value;
  }
  if (extraFileFields.length > 0) {
    // index 142 is the start of the (name, notes, url) triples; replace the
    // single reserved slot with the real triples.
    row.splice(142, 1, ...extraFileFields);
  }
  return row;
}

const HEADER = new Array(143).fill('');

describe('parsePiecesRows', () => {
  it('maps a well-formed single-artist row with a bare creation year', () => {
    const row = piecesRow({
      0: '4969619',
      1: '"Cash Tendered" February 1 2003 NYC',
      2: 'Nicolas',
      3: 'Dumit-Estevez',
      5: '980003',
      7: 'Work on Paper',
      9: '5.5',
      13: '',
      23: '2003',
      26: 'not_for_sale',
      55: '1.0',
      56: '$',
      140: 'true',
      141: '2024-11-13',
    });

    const { records, warnings, skipped } = parsePiecesRows([HEADER, row]);

    expect(skipped).toEqual([]);
    expect(warnings).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourcePieceId: 4969619,
      title: '"Cash Tendered" February 1 2003 NYC',
      type: 'Work on Paper',
      height: '5.5',
      creationYear: 2003,
      framed: false,
      isPublic: true,
      purchasePrice: '1.0',
      purchaseCurrency: '$',
      artistSourceIds: [980003],
      images: [],
      files: [],
    });
  });

  it('extracts the leading year from a year-month creation date', () => {
    const row = piecesRow({ 0: '1', 5: '1', 23: '2017-06' });

    const { records } = parsePiecesRows([HEADER, row]);

    expect(records[0].creationYear).toBe(2017);
  });

  it('parses primary and additional images, skipping the primary slot when its URL is blank', () => {
    const row = piecesRow({
      0: '1',
      5: '1',
      76: 'https://example.com/primary.jpg',
      78: 'https://example.com/additional-1.jpg',
      79: 'first additional',
    });

    const { records } = parsePiecesRows([HEADER, row]);

    expect(records[0].images).toEqual([
      { url: 'https://example.com/primary.jpg', caption: null, sortOrder: 0, isPrimary: true },
      { url: 'https://example.com/additional-1.jpg', caption: 'first additional', sortOrder: 1, isPrimary: false },
    ]);
  });

  it('chunks the Additional Files tail into name/notes/url triples', () => {
    const row = piecesRow(
      { 0: '1', 5: '1' },
      ['Zero Art Fair contract', '', 'https://example.com/contract.pdf'],
    );

    const { records } = parsePiecesRows([HEADER, row]);

    expect(records[0].files).toEqual([
      { name: 'Zero Art Fair contract', notes: null, url: 'https://example.com/contract.pdf', sortOrder: 0 },
    ]);
  });

  it('chunks multiple Additional Files triples in one row', () => {
    const row = piecesRow(
      { 0: '1', 5: '1' },
      [
        'Front', '', 'https://example.com/front.jpg',
        'Back', '', 'https://example.com/back.jpg',
      ],
    );

    const { records } = parsePiecesRows([HEADER, row]);

    expect(records[0].files).toEqual([
      { name: 'Front', notes: null, url: 'https://example.com/front.jpg', sortOrder: 0 },
      { name: 'Back', notes: null, url: 'https://example.com/back.jpg', sortOrder: 1 },
    ]);
  });

  it('parses a comma-delimited Artist Id(s) list as primary + additional artists', () => {
    const row = piecesRow({ 0: '1', 5: '100, 200' });

    const { records } = parsePiecesRows([HEADER, row]);

    expect(records[0].artistSourceIds).toEqual([100, 200]);
  });

  it('skips a row with a missing Piece Id', () => {
    const row = piecesRow({ 5: '1' });
    row[0] = '';

    const { records, skipped } = parsePiecesRows([HEADER, row]);

    expect(records).toEqual([]);
    expect(skipped).toEqual([{ row: 2, reason: 'missing/invalid Piece Id ""' }]);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm test -- parse-pieces`

Expected: FAIL — cannot find module `'../../scripts/import/parse-pieces'`.

- [ ] **Step 7: Implement `parse-pieces.ts`**

```typescript
// scripts/import/parse-pieces.ts
import {
  cleanText,
  parseBoolean,
  parseCreationYear,
  parseDateOrNull,
  parseDelimited,
  parseNumericOrNull,
  parseTimestampOrNull,
} from './normalize';
import type { RowIssue } from './parse-contacts';

export type { RowIssue };

export interface ArtworkImageRecord {
  url: string;
  caption: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface ArtworkFileRecord {
  name: string | null;
  notes: string | null;
  url: string;
  sortOrder: number;
}

export interface ArtworkRecord {
  rowNumber: number;
  sourcePieceId: number;
  title: string | null;
  inventoryNumber: string | null;
  type: string | null;
  medium: string | null;
  subjectMatter: string | null;
  height: string | null;
  width: string | null;
  depth: string | null;
  dimensionOverride: string | null;
  weight: string | null;
  framed: boolean;
  framedHeight: string | null;
  framedWidth: string | null;
  framedDepth: string | null;
  paperHeight: string | null;
  paperWidth: string | null;
  creationYear: number | null;
  creationDateCirca: boolean;
  creationDateOverride: string | null;
  description: string | null;
  notes: string | null;
  signed: boolean;
  signatureNotes: string | null;
  currentLocationName: string | null;
  sourceCurrentLocationId: number | null;
  currentSubLocationName: string | null;
  currentTertiaryLocationName: string | null;
  currentLocationStartDate: string | null;
  currentLocationEndDate: string | null;
  currentLocationNotes: string | null;
  currentLocationLatitude: string | null;
  currentLocationLongitude: string | null;
  provenanceNotes: string | null;
  condition: string | null;
  conditionNotes: string | null;
  edition: string | null;
  editionInfo: string | null;
  purchaseDate: string | null;
  purchasePrice: string | null;
  purchaseCurrency: string | null;
  sourcePurchaseLocationId: number | null;
  purchaseLocationName: string | null;
  sellerSourceContactId: number | null;
  attribution: string | null;
  fairMarketValue: string | null;
  insuranceValue: string | null;
  source: string | null;
  purchaseUrl: string | null;
  lastUpdated: Date | null;
  lastUpdatedBy: string | null;
  isPublic: boolean;
  dateAdded: string | null;
  artistSourceIds: number[];
  collections: string[];
  tags: string[];
  images: ArtworkImageRecord[];
  files: ArtworkFileRecord[];
}

export interface ParsePiecesResult {
  records: ArtworkRecord[];
  warnings: RowIssue[];
  skipped: RowIssue[];
}

function parseIntOrNull(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '' || !Number.isFinite(Number(trimmed))) return null;
  return Number(trimmed);
}

function parseImages(row: string[]): ArtworkImageRecord[] {
  const images: ArtworkImageRecord[] = [];
  const primaryUrl = cleanText(row[76]);
  if (primaryUrl) {
    images.push({ url: primaryUrl, caption: cleanText(row[77]), sortOrder: 0, isPrimary: true });
  }
  for (let n = 1; n <= 30; n++) {
    const urlIndex = 78 + (n - 1) * 2;
    const captionIndex = urlIndex + 1;
    const url = cleanText(row[urlIndex]);
    if (!url) continue;
    images.push({ url, caption: cleanText(row[captionIndex]), sortOrder: images.length, isPrimary: false });
  }
  return images;
}

function parseFiles(row: string[]): ArtworkFileRecord[] {
  const tail = row.slice(142);
  if (tail.length <= 1) return [];
  const usableLength = tail.length - (tail.length % 3);
  const files: ArtworkFileRecord[] = [];
  for (let offset = 0; offset < usableLength; offset += 3) {
    const name = cleanText(tail[offset]);
    const notes = cleanText(tail[offset + 1]);
    const url = cleanText(tail[offset + 2]);
    if (!name && !notes && !url) continue;
    if (!url) continue;
    files.push({ name, notes, url, sortOrder: files.length });
  }
  return files;
}

export function parsePiecesRows(rows: string[][]): ParsePiecesResult {
  const records: ArtworkRecord[] = [];
  const warnings: RowIssue[] = [];
  const skipped: RowIssue[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;
    const sourcePieceIdRaw = row[0]?.trim() ?? '';
    const sourcePieceId = Number(sourcePieceIdRaw);

    if (sourcePieceIdRaw === '' || !Number.isFinite(sourcePieceId)) {
      skipped.push({ row: rowNumber, reason: `missing/invalid Piece Id "${sourcePieceIdRaw}"` });
      continue;
    }

    const height = parseNumericOrNull(row[9], 'Height');
    const width = parseNumericOrNull(row[10], 'Width');
    const depth = parseNumericOrNull(row[11], 'Depth');
    const weight = parseNumericOrNull(row[19], 'Weight');
    const framedHeight = parseNumericOrNull(row[14], 'Framed Height');
    const framedWidth = parseNumericOrNull(row[15], 'Framed Width');
    const framedDepth = parseNumericOrNull(row[16], 'Framed Depth');
    const paperHeight = parseNumericOrNull(row[17], 'Paper Height');
    const paperWidth = parseNumericOrNull(row[18], 'Paper Width');
    const purchasePrice = parseNumericOrNull(row[55], 'Purchase Price');
    const fairMarketValue = parseNumericOrNull(row[69], 'Fair Market Value');
    const insuranceValue = parseNumericOrNull(row[70], 'Insurance Value');
    const currentLocationLatitude = parseNumericOrNull(row[40], 'Current Location Latitude');
    const currentLocationLongitude = parseNumericOrNull(row[41], 'Current Location Longitude');
    const creationYear = parseCreationYear(row[23]);
    const purchaseDate = parseDateOrNull(row[54], 'Purchase Date');
    const currentLocationStartDate = parseDateOrNull(row[37], 'Current Location Start Date');
    const currentLocationEndDate = parseDateOrNull(row[38], 'Current Location End Date');
    const dateAdded = parseDateOrNull(row[141], 'Date Added');
    const lastUpdated = parseTimestampOrNull(row[138], 'Last Updated');

    for (const result of [
      height, width, depth, weight, framedHeight, framedWidth, framedDepth, paperHeight,
      paperWidth, purchasePrice, fairMarketValue, insuranceValue, currentLocationLatitude,
      currentLocationLongitude, creationYear, purchaseDate, currentLocationStartDate,
      currentLocationEndDate, dateAdded, lastUpdated,
    ]) {
      if (result.warning) warnings.push({ row: rowNumber, reason: result.warning.reason });
    }

    const artistIds = parseDelimited(row[5])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    const additionalArtistNames = parseDelimited(row[4]);
    if (additionalArtistNames.length > artistIds.length - 1) {
      warnings.push({
        row: rowNumber,
        reason: `${additionalArtistNames.length} additional artist name(s) but only ${Math.max(artistIds.length - 1, 0)} additional id(s)`,
      });
    }

    records.push({
      rowNumber,
      sourcePieceId,
      title: cleanText(row[1]),
      inventoryNumber: cleanText(row[6]),
      type: cleanText(row[7]),
      medium: cleanText(row[8]),
      subjectMatter: cleanText(row[20]),
      height: height.value,
      width: width.value,
      depth: depth.value,
      dimensionOverride: cleanText(row[12]),
      weight: weight.value,
      framed: parseBoolean(row[13]),
      framedHeight: framedHeight.value,
      framedWidth: framedWidth.value,
      framedDepth: framedDepth.value,
      paperHeight: paperHeight.value,
      paperWidth: paperWidth.value,
      creationYear: creationYear.value,
      creationDateCirca: parseBoolean(row[24]),
      creationDateOverride: cleanText(row[25]),
      description: cleanText(row[27]),
      notes: cleanText(row[28]),
      signed: parseBoolean(row[31]),
      signatureNotes: cleanText(row[32]),
      currentLocationName: cleanText(row[33]),
      sourceCurrentLocationId: parseIntOrNull(row[34]),
      currentSubLocationName: cleanText(row[35]),
      currentTertiaryLocationName: cleanText(row[36]),
      currentLocationStartDate: currentLocationStartDate.value,
      currentLocationEndDate: currentLocationEndDate.value,
      currentLocationNotes: cleanText(row[39]),
      currentLocationLatitude: currentLocationLatitude.value,
      currentLocationLongitude: currentLocationLongitude.value,
      provenanceNotes: cleanText(row[49]),
      condition: cleanText(row[50]),
      conditionNotes: cleanText(row[51]),
      edition: cleanText(row[52]),
      editionInfo: cleanText(row[53]),
      purchaseDate: purchaseDate.value,
      purchasePrice: purchasePrice.value,
      purchaseCurrency: cleanText(row[56]),
      sourcePurchaseLocationId: parseIntOrNull(row[57]),
      purchaseLocationName: cleanText(row[58]),
      sellerSourceContactId: parseIntOrNull(row[59]),
      attribution: cleanText(row[68]),
      fairMarketValue: fairMarketValue.value,
      insuranceValue: insuranceValue.value,
      source: cleanText(row[71]),
      purchaseUrl: cleanText(row[75]),
      lastUpdated: lastUpdated.value,
      lastUpdatedBy: cleanText(row[139]),
      isPublic: parseBoolean(row[140]),
      dateAdded: dateAdded.value,
      artistSourceIds: artistIds,
      collections: parseDelimited(row[29]),
      tags: parseDelimited(row[30]),
      images: parseImages(row),
      files: parseFiles(row),
    });
  }

  return { records, warnings, skipped };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test -- parse-pieces`

Expected: PASS (7 tests).

- [ ] **Step 9: Run the full suite**

Run: `pnpm test`

Expected: PASS — every test in the project, including the new parser tests.

- [ ] **Step 10: Commit**

```bash
git add scripts/import/parse-contacts.ts scripts/import/parse-pieces.ts \
  tests/import/parse-contacts.test.ts tests/import/parse-pieces.test.ts
git commit -m "feat: add CSV row parsers for contacts and pieces"
```

---

## Task 4: Lookup upserts and `importContacts`

**Files:**
- Create: `scripts/import/lookups.ts`
- Create: `scripts/import/import-contacts.ts`
- Test: `tests/import/lookups.test.ts`
- Test: `tests/import/import-contacts.test.ts`

**Interfaces:**
- Consumes: `Db` type (Task 2), `cleanText` (Task 2), `ContactRecord` (Task 3).
- Produces: `getOrCreateTag(db, rawName): Promise<number | null>`, `getOrCreateGroup`, `getOrCreateCollection` (same shape) from `lookups.ts` — Task 5 reuses `getOrCreateTag`/`getOrCreateCollection` for artworks. `TableImportResult { processed: number; skipped: number; warnings: number }` and `ImportContactsResult { idMap: Map<number, number>; contacts: TableImportResult; contactGroups: TableImportResult; contactTags: TableImportResult }` from `import-contacts.ts` — Task 5 imports `TableImportResult` for its own return shape and consumes the `idMap` (source contact id → internal id) to resolve seller/artist references; Task 6 consumes `importContacts` and all three `TableImportResult`s for the run summary.

- [ ] **Step 1: Write the failing tests for `lookups.ts`**

```typescript
// tests/import/lookups.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { collections, groups, tags } from '../../src/db/schema';
import { getOrCreateCollection, getOrCreateGroup, getOrCreateTag } from '../../scripts/import/lookups';

describe('getOrCreateTag / getOrCreateGroup / getOrCreateCollection', () => {
  it('creates a new tag, then reuses the same row on a second call', async () => {
    const name = `import-test-tag-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;

    try {
      const firstId = await getOrCreateTag(testDb, name);
      const secondId = await getOrCreateTag(testDb, name);

      expect(firstId).not.toBeNull();
      expect(secondId).toBe(firstId);

      const rows = await testDb.select().from(tags).where(eq(tags.name, name));
      expect(rows).toHaveLength(1);
    } finally {
      await testDb.delete(tags).where(eq(tags.name, name));
    }
  });

  it('creates a new group and a new collection independently', async () => {
    const groupName = `import-test-group-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
    const collectionName = `import-test-collection-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;

    try {
      const groupId = await getOrCreateGroup(testDb, groupName);
      const collectionId = await getOrCreateCollection(testDb, collectionName);

      expect(groupId).not.toBeNull();
      expect(collectionId).not.toBeNull();

      const groupRows = await testDb.select().from(groups).where(eq(groups.name, groupName));
      const collectionRows = await testDb.select().from(collections).where(eq(collections.name, collectionName));
      expect(groupRows).toHaveLength(1);
      expect(collectionRows).toHaveLength(1);
    } finally {
      await testDb.delete(groups).where(eq(groups.name, groupName));
      await testDb.delete(collections).where(eq(collections.name, collectionName));
    }
  });

  it('returns null for a blank name without touching the database', async () => {
    expect(await getOrCreateTag(testDb, '')).toBeNull();
    expect(await getOrCreateGroup(testDb, '   ')).toBeNull();
    expect(await getOrCreateCollection(testDb, '')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- lookups`

Expected: FAIL — cannot find module `'../../scripts/import/lookups'`. (Note: this collides on filename with the existing `tests/db/lookups.test.ts` from the schema phase — use `pnpm test -- import/lookups` if the plain `-- lookups` filter matches both.)

- [ ] **Step 3: Implement `lookups.ts`**

```typescript
// scripts/import/lookups.ts
import type { Db } from '../../src/db/client';
import { collections, groups, tags } from '../../src/db/schema';
import { cleanText } from './normalize';

export async function getOrCreateTag(db: Db, rawName: string): Promise<number | null> {
  const name = cleanText(rawName);
  if (!name) return null;
  const [row] = await db
    .insert(tags)
    .values({ name })
    .onConflictDoUpdate({ target: tags.name, set: { name } })
    .returning({ id: tags.id });
  return row.id;
}

export async function getOrCreateGroup(db: Db, rawName: string): Promise<number | null> {
  const name = cleanText(rawName);
  if (!name) return null;
  const [row] = await db
    .insert(groups)
    .values({ name })
    .onConflictDoUpdate({ target: groups.name, set: { name } })
    .returning({ id: groups.id });
  return row.id;
}

export async function getOrCreateCollection(db: Db, rawName: string): Promise<number | null> {
  const name = cleanText(rawName);
  if (!name) return null;
  const [row] = await db
    .insert(collections)
    .values({ name })
    .onConflictDoUpdate({ target: collections.name, set: { name } })
    .returning({ id: collections.id });
  return row.id;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- import/lookups`

Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing tests for `import-contacts.ts`**

```typescript
// tests/import/import-contacts.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { contactGroups, contactTags, contacts, groups, tags } from '../../src/db/schema';
import { importContacts } from '../../scripts/import/import-contacts';
import type { ContactRecord } from '../../scripts/import/parse-contacts';

function baseContactRecord(overrides: Partial<ContactRecord>): ContactRecord {
  return {
    rowNumber: 2,
    sourceContactId: Math.floor(Math.random() * 1_000_000_000),
    title: null,
    firstName: null,
    lastName: null,
    email: null,
    secondaryEmail: null,
    jobTitle: null,
    companyName: null,
    workPhone: null,
    phone: null,
    mobilePhone: null,
    website: null,
    birthDate: null,
    deathDate: null,
    nationality: null,
    address1: null,
    address2: null,
    city: null,
    state: null,
    zip: null,
    country: null,
    secondaryAddress1: null,
    secondaryAddress2: null,
    secondaryCity: null,
    secondaryState: null,
    secondaryZip: null,
    secondaryCountry: null,
    isArtist: false,
    bio: null,
    notes: null,
    location: null,
    sourceLocationId: null,
    instagramUrl: null,
    dateAdded: null,
    groups: [],
    tags: [],
    ...overrides,
  };
}

describe('importContacts', () => {
  it('inserts a contact and its groups/tags, mapping sourceContactId to the internal id', async () => {
    const record = baseContactRecord({
      firstName: 'Ada',
      lastName: 'Lovelace',
      isArtist: true,
      groups: ['Female Artists'],
      tags: ['Test Tag'],
    });

    try {
      const result = await importContacts(testDb, [record]);

      expect(result.contacts.processed).toBe(1);
      expect(result.idMap.get(record.sourceContactId)).toBeTypeOf('number');

      const [row] = await testDb
        .select()
        .from(contacts)
        .where(eq(contacts.sourceContactId, record.sourceContactId));
      expect(row.firstName).toBe('Ada');
      expect(row.isArtist).toBe(true);

      const groupLinks = await testDb.select().from(contactGroups).where(eq(contactGroups.contactId, row.id));
      const tagLinks = await testDb.select().from(contactTags).where(eq(contactTags.contactId, row.id));
      expect(groupLinks).toHaveLength(1);
      expect(tagLinks).toHaveLength(1);
    } finally {
      const [row] = await testDb
        .select()
        .from(contacts)
        .where(eq(contacts.sourceContactId, record.sourceContactId));
      if (row) {
        await testDb.delete(contactGroups).where(eq(contactGroups.contactId, row.id));
        await testDb.delete(contactTags).where(eq(contactTags.contactId, row.id));
      }
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, record.sourceContactId));
      await testDb.delete(groups).where(eq(groups.name, 'Female Artists'));
      await testDb.delete(tags).where(eq(tags.name, 'Test Tag'));
    }
  });

  it('is idempotent: importing the same record twice does not duplicate rows', async () => {
    const record = baseContactRecord({ firstName: 'Grace', lastName: 'Hopper', tags: ['Idempotent Tag'] });

    try {
      await importContacts(testDb, [record]);
      const result = await importContacts(testDb, [record]);

      expect(result.idMap.get(record.sourceContactId)).toBeTypeOf('number');
      const rows = await testDb
        .select()
        .from(contacts)
        .where(eq(contacts.sourceContactId, record.sourceContactId));
      expect(rows).toHaveLength(1);

      const tagLinks = await testDb.select().from(contactTags).where(eq(contactTags.contactId, rows[0].id));
      expect(tagLinks).toHaveLength(1);
    } finally {
      const [row] = await testDb
        .select()
        .from(contacts)
        .where(eq(contacts.sourceContactId, record.sourceContactId));
      if (row) {
        await testDb.delete(contactTags).where(eq(contactTags.contactId, row.id));
      }
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, record.sourceContactId));
      await testDb.delete(tags).where(eq(tags.name, 'Idempotent Tag'));
    }
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm test -- import/import-contacts`

Expected: FAIL — cannot find module `'../../scripts/import/import-contacts'`.

- [ ] **Step 7: Implement `import-contacts.ts`**

```typescript
// scripts/import/import-contacts.ts
import { eq } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import { contactGroups, contactTags, contacts } from '../../src/db/schema';
import { getOrCreateGroup, getOrCreateTag } from './lookups';
import type { ContactRecord } from './parse-contacts';

export interface TableImportResult {
  processed: number;
  skipped: number;
  warnings: number;
}

export interface ImportContactsResult {
  idMap: Map<number, number>;
  contacts: TableImportResult;
  contactGroups: TableImportResult;
  contactTags: TableImportResult;
}

function emptyResult(): TableImportResult {
  return { processed: 0, skipped: 0, warnings: 0 };
}

export async function importContacts(db: Db, records: ContactRecord[]): Promise<ImportContactsResult> {
  const idMap = new Map<number, number>();
  const contactsResult = emptyResult();
  const contactGroupsResult = emptyResult();
  const contactTagsResult = emptyResult();

  for (const record of records) {
    const values = {
      sourceContactId: record.sourceContactId,
      title: record.title,
      firstName: record.firstName,
      lastName: record.lastName,
      email: record.email,
      secondaryEmail: record.secondaryEmail,
      jobTitle: record.jobTitle,
      companyName: record.companyName,
      workPhone: record.workPhone,
      phone: record.phone,
      mobilePhone: record.mobilePhone,
      website: record.website,
      birthDate: record.birthDate,
      deathDate: record.deathDate,
      nationality: record.nationality,
      address1: record.address1,
      address2: record.address2,
      city: record.city,
      state: record.state,
      zip: record.zip,
      country: record.country,
      secondaryAddress1: record.secondaryAddress1,
      secondaryAddress2: record.secondaryAddress2,
      secondaryCity: record.secondaryCity,
      secondaryState: record.secondaryState,
      secondaryZip: record.secondaryZip,
      secondaryCountry: record.secondaryCountry,
      isArtist: record.isArtist,
      bio: record.bio,
      notes: record.notes,
      location: record.location,
      sourceLocationId: record.sourceLocationId,
      instagramUrl: record.instagramUrl,
      dateAdded: record.dateAdded,
    };

    const [row] = await db
      .insert(contacts)
      .values(values)
      .onConflictDoUpdate({ target: contacts.sourceContactId, set: values })
      .returning({ id: contacts.id });

    idMap.set(record.sourceContactId, row.id);
    contactsResult.processed++;

    const groupIds = (await Promise.all(record.groups.map((name) => getOrCreateGroup(db, name)))).filter(
      (id): id is number => id !== null,
    );
    await db.delete(contactGroups).where(eq(contactGroups.contactId, row.id));
    if (groupIds.length > 0) {
      await db.insert(contactGroups).values(groupIds.map((groupId) => ({ contactId: row.id, groupId })));
    }
    contactGroupsResult.processed += groupIds.length;

    const tagIds = (await Promise.all(record.tags.map((name) => getOrCreateTag(db, name)))).filter(
      (id): id is number => id !== null,
    );
    await db.delete(contactTags).where(eq(contactTags.contactId, row.id));
    if (tagIds.length > 0) {
      await db.insert(contactTags).values(tagIds.map((tagId) => ({ contactId: row.id, tagId })));
    }
    contactTagsResult.processed += tagIds.length;
  }

  return { idMap, contacts: contactsResult, contactGroups: contactGroupsResult, contactTags: contactTagsResult };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test -- import/import-contacts`

Expected: PASS (2 tests).

- [ ] **Step 9: Run the full suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/import/lookups.ts scripts/import/import-contacts.ts \
  tests/import/lookups.test.ts tests/import/import-contacts.test.ts
git commit -m "feat: add lookup upserts and importContacts"
```

---

## Task 5: `importArtworks`

**Files:**
- Create: `scripts/import/import-artworks.ts`
- Test: `tests/import/import-artworks.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 2), `TableImportResult` (Task 4, re-exported from `import-contacts.ts`), `getOrCreateCollection`/`getOrCreateTag` (Task 4), `ArtworkRecord` (Task 3).
- Produces: `ImportArtworksResult { artworks: TableImportResult; artworkArtists: TableImportResult; artworkImages: TableImportResult; artworkFiles: TableImportResult; artworkCollections: TableImportResult; artworkTags: TableImportResult; warningMessages: string[] }` and `importArtworks(db, records, contactIdMap): Promise<ImportArtworksResult>`. Task 6 consumes this directly to build the run summary.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/import/import-artworks.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import {
  artworkArtists,
  artworkCollections,
  artworkFiles,
  artworkImages,
  artworkTags,
  artworks,
  collections,
  contacts,
  tags,
} from '../../src/db/schema';
import { importArtworks } from '../../scripts/import/import-artworks';
import type { ArtworkRecord } from '../../scripts/import/parse-pieces';

function baseArtworkRecord(overrides: Partial<ArtworkRecord>): ArtworkRecord {
  return {
    rowNumber: 2,
    sourcePieceId: Math.floor(Math.random() * 1_000_000_000),
    title: null,
    inventoryNumber: null,
    type: null,
    medium: null,
    subjectMatter: null,
    height: null,
    width: null,
    depth: null,
    dimensionOverride: null,
    weight: null,
    framed: false,
    framedHeight: null,
    framedWidth: null,
    framedDepth: null,
    paperHeight: null,
    paperWidth: null,
    creationYear: null,
    creationDateCirca: false,
    creationDateOverride: null,
    description: null,
    notes: null,
    signed: false,
    signatureNotes: null,
    currentLocationName: null,
    sourceCurrentLocationId: null,
    currentSubLocationName: null,
    currentTertiaryLocationName: null,
    currentLocationStartDate: null,
    currentLocationEndDate: null,
    currentLocationNotes: null,
    currentLocationLatitude: null,
    currentLocationLongitude: null,
    provenanceNotes: null,
    condition: null,
    conditionNotes: null,
    edition: null,
    editionInfo: null,
    purchaseDate: null,
    purchasePrice: null,
    purchaseCurrency: null,
    sourcePurchaseLocationId: null,
    purchaseLocationName: null,
    sellerSourceContactId: null,
    attribution: null,
    fairMarketValue: null,
    insuranceValue: null,
    source: null,
    purchaseUrl: null,
    lastUpdated: null,
    lastUpdatedBy: null,
    isPublic: false,
    dateAdded: null,
    artistSourceIds: [],
    collections: [],
    tags: [],
    images: [],
    files: [],
    ...overrides,
  };
}

describe('importArtworks', () => {
  it('inserts an artwork with a resolved seller, two artists, an image, a file, a collection, and a tag', async () => {
    const primarySourceId = Math.floor(Math.random() * 1_000_000_000);
    const additionalSourceId = Math.floor(Math.random() * 1_000_000_000);
    const sellerSourceId = Math.floor(Math.random() * 1_000_000_000);
    // Randomized rather than a fixed literal: tags/collections are globally
    // unique-by-name across the whole test database, and Vitest runs test
    // files in parallel — a fixed name here would race with the same fixed
    // name used by a different test file's cleanup.
    const collectionName = `Test Collection ${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
    const tagName = `Test Tag ${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;

    const [primary] = await testDb
      .insert(contacts)
      .values({ sourceContactId: primarySourceId, firstName: 'Primary' })
      .returning();
    const [additional] = await testDb
      .insert(contacts)
      .values({ sourceContactId: additionalSourceId, firstName: 'Additional' })
      .returning();
    const [seller] = await testDb
      .insert(contacts)
      .values({ sourceContactId: sellerSourceId, companyName: 'Seller Gallery' })
      .returning();

    const contactIdMap = new Map([
      [primarySourceId, primary.id],
      [additionalSourceId, additional.id],
      [sellerSourceId, seller.id],
    ]);

    const record = baseArtworkRecord({
      title: 'Collaborative Piece',
      sellerSourceContactId: sellerSourceId,
      artistSourceIds: [primarySourceId, additionalSourceId],
      images: [{ url: 'https://example.com/image.jpg', caption: null, sortOrder: 0, isPrimary: true }],
      files: [{ name: 'Receipt', notes: null, url: 'https://example.com/receipt.pdf', sortOrder: 0 }],
      collections: [collectionName],
      tags: [tagName],
    });

    try {
      const result = await importArtworks(testDb, [record], contactIdMap);

      expect(result.artworks.processed).toBe(1);
      expect(result.artworkArtists.processed).toBe(2);
      expect(result.artworkImages.processed).toBe(1);
      expect(result.artworkFiles.processed).toBe(1);
      expect(result.artworkCollections.processed).toBe(1);
      expect(result.artworkTags.processed).toBe(1);
      expect(result.warningMessages).toEqual([]);

      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      expect(artwork.sellerContactId).toBe(seller.id);

      const artistLinks = await testDb
        .select()
        .from(artworkArtists)
        .where(eq(artworkArtists.artworkId, artwork.id));
      expect(artistLinks.find((l) => l.contactId === primary.id)?.role).toBe('primary');
      expect(artistLinks.find((l) => l.contactId === additional.id)?.role).toBe('additional');
    } finally {
      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      if (artwork) {
        await testDb.delete(artworkArtists).where(eq(artworkArtists.artworkId, artwork.id));
        await testDb.delete(artworkImages).where(eq(artworkImages.artworkId, artwork.id));
        await testDb.delete(artworkFiles).where(eq(artworkFiles.artworkId, artwork.id));
        await testDb.delete(artworkCollections).where(eq(artworkCollections.artworkId, artwork.id));
        await testDb.delete(artworkTags).where(eq(artworkTags.artworkId, artwork.id));
      }
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, primarySourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, additionalSourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sellerSourceId));
      await testDb.delete(collections).where(eq(collections.name, collectionName));
      await testDb.delete(tags).where(eq(tags.name, tagName));
    }
  });

  it('warns and leaves sellerContactId null when the seller contact is not found', async () => {
    const record = baseArtworkRecord({ title: 'Orphan Seller Piece', sellerSourceContactId: 999_999_999 });

    try {
      const result = await importArtworks(testDb, [record], new Map());

      expect(result.warningMessages).toEqual([`row ${record.rowNumber}: seller contact id 999999999 not found`]);
      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      expect(artwork.sellerContactId).toBeNull();
    } finally {
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
    }
  });

  it('warns and drops an unresolvable artist id while keeping resolvable ones', async () => {
    const knownSourceId = Math.floor(Math.random() * 1_000_000_000);
    const [known] = await testDb
      .insert(contacts)
      .values({ sourceContactId: knownSourceId, firstName: 'Known' })
      .returning();
    const record = baseArtworkRecord({
      title: 'Partially Resolvable Piece',
      artistSourceIds: [knownSourceId, 999_999_999],
    });

    try {
      const result = await importArtworks(testDb, [record], new Map([[knownSourceId, known.id]]));

      expect(result.artworkArtists.processed).toBe(1);
      expect(result.warningMessages).toEqual([`row ${record.rowNumber}: artist id 999999999 not found in contacts`]);
      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      const links = await testDb.select().from(artworkArtists).where(eq(artworkArtists.artworkId, artwork.id));
      expect(links).toHaveLength(1);
      expect(links[0].role).toBe('primary');
    } finally {
      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      if (artwork) await testDb.delete(artworkArtists).where(eq(artworkArtists.artworkId, artwork.id));
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, knownSourceId));
    }
  });

  it('is idempotent: importing the same record twice does not duplicate rows', async () => {
    const record = baseArtworkRecord({
      title: 'Idempotent Piece',
      tags: ['Idempotent Artwork Tag'],
      images: [{ url: 'https://example.com/idempotent.jpg', caption: null, sortOrder: 0, isPrimary: true }],
    });

    try {
      await importArtworks(testDb, [record], new Map());
      await importArtworks(testDb, [record], new Map());

      const rows = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      expect(rows).toHaveLength(1);

      const imageRows = await testDb.select().from(artworkImages).where(eq(artworkImages.artworkId, rows[0].id));
      expect(imageRows).toHaveLength(1);

      const tagRows = await testDb.select().from(artworkTags).where(eq(artworkTags.artworkId, rows[0].id));
      expect(tagRows).toHaveLength(1);
    } finally {
      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      if (artwork) {
        await testDb.delete(artworkImages).where(eq(artworkImages.artworkId, artwork.id));
        await testDb.delete(artworkTags).where(eq(artworkTags.artworkId, artwork.id));
      }
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      await testDb.delete(tags).where(eq(tags.name, 'Idempotent Artwork Tag'));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- import/import-artworks`

Expected: FAIL — cannot find module `'../../scripts/import/import-artworks'`.

- [ ] **Step 3: Implement `import-artworks.ts`**

```typescript
// scripts/import/import-artworks.ts
import { eq } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import {
  artworkArtists,
  artworkCollections,
  artworkFiles,
  artworkImages,
  artworkTags,
  artworks,
} from '../../src/db/schema';
import type { TableImportResult } from './import-contacts';
import { getOrCreateCollection, getOrCreateTag } from './lookups';
import type { ArtworkRecord } from './parse-pieces';

export interface ImportArtworksResult {
  artworks: TableImportResult;
  artworkArtists: TableImportResult;
  artworkImages: TableImportResult;
  artworkFiles: TableImportResult;
  artworkCollections: TableImportResult;
  artworkTags: TableImportResult;
  warningMessages: string[];
}

function emptyResult(): TableImportResult {
  return { processed: 0, skipped: 0, warnings: 0 };
}

export async function importArtworks(
  db: Db,
  records: ArtworkRecord[],
  contactIdMap: Map<number, number>,
): Promise<ImportArtworksResult> {
  const artworksResult = emptyResult();
  const artworkArtistsResult = emptyResult();
  const artworkImagesResult = emptyResult();
  const artworkFilesResult = emptyResult();
  const artworkCollectionsResult = emptyResult();
  const artworkTagsResult = emptyResult();
  const warningMessages: string[] = [];

  for (const record of records) {
    let sellerContactId: number | null = null;
    if (record.sellerSourceContactId !== null) {
      sellerContactId = contactIdMap.get(record.sellerSourceContactId) ?? null;
      if (sellerContactId === null) {
        warningMessages.push(`row ${record.rowNumber}: seller contact id ${record.sellerSourceContactId} not found`);
        artworksResult.warnings++;
      }
    }

    const values = {
      sourcePieceId: record.sourcePieceId,
      title: record.title,
      inventoryNumber: record.inventoryNumber,
      type: record.type,
      medium: record.medium,
      subjectMatter: record.subjectMatter,
      height: record.height,
      width: record.width,
      depth: record.depth,
      dimensionOverride: record.dimensionOverride,
      weight: record.weight,
      framed: record.framed,
      framedHeight: record.framedHeight,
      framedWidth: record.framedWidth,
      framedDepth: record.framedDepth,
      paperHeight: record.paperHeight,
      paperWidth: record.paperWidth,
      creationYear: record.creationYear,
      creationDateCirca: record.creationDateCirca,
      creationDateOverride: record.creationDateOverride,
      description: record.description,
      notes: record.notes,
      signed: record.signed,
      signatureNotes: record.signatureNotes,
      condition: record.condition,
      conditionNotes: record.conditionNotes,
      edition: record.edition,
      editionInfo: record.editionInfo,
      attribution: record.attribution,
      isPublic: record.isPublic,
      purchaseDate: record.purchaseDate,
      purchasePrice: record.purchasePrice,
      purchaseCurrency: record.purchaseCurrency,
      sourcePurchaseLocationId: record.sourcePurchaseLocationId,
      purchaseLocationName: record.purchaseLocationName,
      sellerContactId,
      purchaseUrl: record.purchaseUrl,
      fairMarketValue: record.fairMarketValue,
      insuranceValue: record.insuranceValue,
      provenanceNotes: record.provenanceNotes,
      source: record.source,
      currentLocationName: record.currentLocationName,
      sourceCurrentLocationId: record.sourceCurrentLocationId,
      currentSubLocationName: record.currentSubLocationName,
      currentTertiaryLocationName: record.currentTertiaryLocationName,
      currentLocationStartDate: record.currentLocationStartDate,
      currentLocationEndDate: record.currentLocationEndDate,
      currentLocationNotes: record.currentLocationNotes,
      currentLocationLatitude: record.currentLocationLatitude,
      currentLocationLongitude: record.currentLocationLongitude,
      lastUpdated: record.lastUpdated,
      lastUpdatedBy: record.lastUpdatedBy,
      dateAdded: record.dateAdded,
    };

    const [row] = await db
      .insert(artworks)
      .values(values)
      .onConflictDoUpdate({ target: artworks.sourcePieceId, set: values })
      .returning({ id: artworks.id });

    artworksResult.processed++;

    const resolvedArtists: { contactId: number; role: 'primary' | 'additional' }[] = [];
    record.artistSourceIds.forEach((sourceId, index) => {
      const contactId = contactIdMap.get(sourceId);
      if (contactId === undefined) {
        warningMessages.push(`row ${record.rowNumber}: artist id ${sourceId} not found in contacts`);
        artworkArtistsResult.warnings++;
        return;
      }
      resolvedArtists.push({ contactId, role: index === 0 ? 'primary' : 'additional' });
    });
    await db.delete(artworkArtists).where(eq(artworkArtists.artworkId, row.id));
    if (resolvedArtists.length > 0) {
      await db.insert(artworkArtists).values(
        resolvedArtists.map((entry, sortOrder) => ({
          artworkId: row.id,
          contactId: entry.contactId,
          role: entry.role,
          sortOrder,
        })),
      );
    }
    artworkArtistsResult.processed += resolvedArtists.length;

    await db.delete(artworkImages).where(eq(artworkImages.artworkId, row.id));
    if (record.images.length > 0) {
      await db.insert(artworkImages).values(
        record.images.map((image) => ({
          artworkId: row.id,
          sourceUrl: image.url,
          r2Key: null,
          caption: image.caption,
          sortOrder: image.sortOrder,
          isPrimary: image.isPrimary,
        })),
      );
    }
    artworkImagesResult.processed += record.images.length;

    await db.delete(artworkFiles).where(eq(artworkFiles.artworkId, row.id));
    if (record.files.length > 0) {
      await db.insert(artworkFiles).values(
        record.files.map((file) => ({
          artworkId: row.id,
          name: file.name,
          notes: file.notes,
          sourceUrl: file.url,
          r2Key: null,
          sortOrder: file.sortOrder,
        })),
      );
    }
    artworkFilesResult.processed += record.files.length;

    const collectionIds = (
      await Promise.all(record.collections.map((name) => getOrCreateCollection(db, name)))
    ).filter((id): id is number => id !== null);
    await db.delete(artworkCollections).where(eq(artworkCollections.artworkId, row.id));
    if (collectionIds.length > 0) {
      await db
        .insert(artworkCollections)
        .values(collectionIds.map((collectionId) => ({ artworkId: row.id, collectionId })));
    }
    artworkCollectionsResult.processed += collectionIds.length;

    const tagIds = (await Promise.all(record.tags.map((name) => getOrCreateTag(db, name)))).filter(
      (id): id is number => id !== null,
    );
    await db.delete(artworkTags).where(eq(artworkTags.artworkId, row.id));
    if (tagIds.length > 0) {
      await db.insert(artworkTags).values(tagIds.map((tagId) => ({ artworkId: row.id, tagId })));
    }
    artworkTagsResult.processed += tagIds.length;
  }

  return {
    artworks: artworksResult,
    artworkArtists: artworkArtistsResult,
    artworkImages: artworkImagesResult,
    artworkFiles: artworkFilesResult,
    artworkCollections: artworkCollectionsResult,
    artworkTags: artworkTagsResult,
    warningMessages,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- import/import-artworks`

Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/import/import-artworks.ts tests/import/import-artworks.test.ts
git commit -m "feat: add importArtworks"
```

---

## Task 6: Summary, orchestration, and CLI

**Files:**
- Create: `scripts/import/summary.ts`
- Create: `scripts/import/run-import.ts`
- Create: `scripts/import-csv.ts`
- Create: `tests/import/csv-fixture-helpers.ts`
- Modify: `package.json` (add `import:csv` script)
- Test: `tests/import/summary.test.ts`
- Test: `tests/import/run-import-smoke.test.ts`

**Interfaces:**
- Consumes: `TableImportResult` (Task 4), `Db` (Task 2), `parseCsvFile` (Task 2), `parseContactsRows`/`importContacts` (Tasks 3-4), `parsePiecesRows`/`importArtworks` (Tasks 3, 5).
- Produces: `ImportSummary` (full shape below) and `printSummary(summary): void` from `summary.ts`. `RunImportOptions { db: Db; contactsPath: string; piecesPath: string }` and `runImport(options): Promise<ImportSummary>` from `run-import.ts`. `CONTACTS_HEADER: string`, `PIECES_HEADER: string`, `contactsRow(options: ContactRowOptions): string`, `piecesRow(options: PieceRowOptions): string` from `tests/import/csv-fixture-helpers.ts` — Task 7 imports all four of these directly and extends `PieceRowOptions` usage with the `additionalImages`/`files` fields already defined here.

**Why generated fixtures instead of hand-typed CSV files:** the real contacts rows are 45 comma-separated fields and pieces rows are 143+ — hand-typing that many commas correctly (and keeping them correct as scenarios are added) is exactly the kind of silent-miscount risk this whole plan is designed to avoid. Building rows from named-option objects makes every field's position self-documenting and impossible to miscount.

- [ ] **Step 1: Write the failing test for `summary.ts`**

```typescript
// tests/import/summary.test.ts
import { describe, expect, it, vi } from 'vitest';
import { printSummary } from '../../scripts/import/summary';
import type { ImportSummary } from '../../scripts/import/summary';

function emptyResult() {
  return { processed: 0, skipped: 0, warnings: 0 };
}

describe('printSummary', () => {
  it('prints a table of results plus warning and skip messages', () => {
    const summary: ImportSummary = {
      contacts: { processed: 2, skipped: 0, warnings: 0 },
      contactGroups: emptyResult(),
      contactTags: emptyResult(),
      artworks: { processed: 1, skipped: 0, warnings: 1 },
      artworkArtists: emptyResult(),
      artworkImages: emptyResult(),
      artworkFiles: emptyResult(),
      artworkCollections: emptyResult(),
      artworkTags: emptyResult(),
      warningMessages: ['pieces row 5: seller contact id 999 not found'],
      skippedMessages: ['contacts row 9: missing/invalid Contact Id ""'],
    };

    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printSummary(summary);

    expect(tableSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 warning(s)'));
    expect(logSpy).toHaveBeenCalledWith('  [WARN] pieces row 5: seller contact id 999 not found');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 skipped row(s)'));
    expect(logSpy).toHaveBeenCalledWith('  [SKIP] contacts row 9: missing/invalid Contact Id ""');

    tableSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('omits the warning/skip sections when there are none', () => {
    const summary: ImportSummary = {
      contacts: emptyResult(),
      contactGroups: emptyResult(),
      contactTags: emptyResult(),
      artworks: emptyResult(),
      artworkArtists: emptyResult(),
      artworkImages: emptyResult(),
      artworkFiles: emptyResult(),
      artworkCollections: emptyResult(),
      artworkTags: emptyResult(),
      warningMessages: [],
      skippedMessages: [],
    };

    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printSummary(summary);

    expect(logSpy).not.toHaveBeenCalled();

    tableSpy.mockRestore();
    logSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- import/summary`

Expected: FAIL — cannot find module `'../../scripts/import/summary'`.

- [ ] **Step 3: Implement `summary.ts`**

```typescript
// scripts/import/summary.ts
import type { TableImportResult } from './import-contacts';

export interface ImportSummary {
  contacts: TableImportResult;
  contactGroups: TableImportResult;
  contactTags: TableImportResult;
  artworks: TableImportResult;
  artworkArtists: TableImportResult;
  artworkImages: TableImportResult;
  artworkFiles: TableImportResult;
  artworkCollections: TableImportResult;
  artworkTags: TableImportResult;
  warningMessages: string[];
  skippedMessages: string[];
}

export function printSummary(summary: ImportSummary): void {
  console.table({
    contacts: summary.contacts,
    contactGroups: summary.contactGroups,
    contactTags: summary.contactTags,
    artworks: summary.artworks,
    artworkArtists: summary.artworkArtists,
    artworkImages: summary.artworkImages,
    artworkFiles: summary.artworkFiles,
    artworkCollections: summary.artworkCollections,
    artworkTags: summary.artworkTags,
  });

  if (summary.warningMessages.length > 0) {
    console.log(`\n${summary.warningMessages.length} warning(s):`);
    for (const message of summary.warningMessages) {
      console.log(`  [WARN] ${message}`);
    }
  }

  if (summary.skippedMessages.length > 0) {
    console.log(`\n${summary.skippedMessages.length} skipped row(s):`);
    for (const message of summary.skippedMessages) {
      console.log(`  [SKIP] ${message}`);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- import/summary`

Expected: PASS (2 tests).

- [ ] **Step 5: Implement `run-import.ts`**

```typescript
// scripts/import/run-import.ts
import type { Db } from '../../src/db/client';
import { parseCsvFile } from './csv-reader';
import { importArtworks } from './import-artworks';
import { importContacts } from './import-contacts';
import { parseContactsRows } from './parse-contacts';
import { parsePiecesRows } from './parse-pieces';
import type { ImportSummary } from './summary';

export interface RunImportOptions {
  db: Db;
  contactsPath: string;
  piecesPath: string;
}

export async function runImport({ db, contactsPath, piecesPath }: RunImportOptions): Promise<ImportSummary> {
  const contactRows = parseCsvFile(contactsPath);
  const { records: contactRecords, warnings: contactWarnings, skipped: contactSkipped } =
    parseContactsRows(contactRows);
  const contactsImport = await importContacts(db, contactRecords);

  const pieceRows = parseCsvFile(piecesPath);
  const { records: pieceRecords, warnings: pieceWarnings, skipped: pieceSkipped } = parsePiecesRows(pieceRows);
  const artworksImport = await importArtworks(db, pieceRecords, contactsImport.idMap);

  return {
    contacts: contactsImport.contacts,
    contactGroups: contactsImport.contactGroups,
    contactTags: contactsImport.contactTags,
    artworks: artworksImport.artworks,
    artworkArtists: artworksImport.artworkArtists,
    artworkImages: artworksImport.artworkImages,
    artworkFiles: artworksImport.artworkFiles,
    artworkCollections: artworksImport.artworkCollections,
    artworkTags: artworksImport.artworkTags,
    warningMessages: [
      ...contactWarnings.map((issue) => `contacts row ${issue.row}: ${issue.reason}`),
      ...pieceWarnings.map((issue) => `pieces row ${issue.row}: ${issue.reason}`),
      ...artworksImport.warningMessages,
    ],
    skippedMessages: [
      ...contactSkipped.map((issue) => `contacts row ${issue.row}: ${issue.reason}`),
      ...pieceSkipped.map((issue) => `pieces row ${issue.row}: ${issue.reason}`),
    ],
  };
}
```

- [ ] **Step 6: Create the shared CSV fixture-row builders**

```typescript
// tests/import/csv-fixture-helpers.ts
export const CONTACTS_HEADER = [
  'Contact Id', 'Title', 'First Name', 'Last Name', 'Email', 'Secondary Email', 'Job Title',
  'Company Name', 'Work Phone', 'Phone', 'Mobile Phone', 'Website', 'Spouse First', 'Spouse Last',
  'Birth Date', 'Death Date', 'Nationality', 'Address1', 'Address2', 'City', 'State', 'Zip',
  'Country', 'Secondary Address1', 'Secondary Address2', 'Secondary City', 'Secondary State',
  'Secondary Zip', 'Secondary Country', 'Appraiser', 'Artist', 'Artist Piece Count', 'Groups',
  'Tags', 'Bio', 'Notes', 'Location', 'Location Id', 'Facebook URL', 'Instagram URL',
  'Twitter URL', 'LinkedIn URL', 'Pinterest URL', 'Date Added',
].join(',');

export const PIECES_HEADER = Array.from({ length: 143 }, (_, i) => `Col${i}`).join(',');

function csvCell(value: string): string {
  return value.includes(',') || value.includes('"') || value.includes('\n')
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

export interface ContactRowOptions {
  sourceContactId: number;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  birthDate?: string;
  nationality?: string;
  isArtist?: boolean;
  groups?: string;
  instagramUrl?: string;
  dateAdded?: string;
}

export function contactsRow(options: ContactRowOptions): string {
  const cells = new Array(44).fill('');
  cells[0] = String(options.sourceContactId);
  cells[2] = options.firstName ?? '';
  cells[3] = options.lastName ?? '';
  cells[7] = options.companyName ?? '';
  cells[14] = options.birthDate ?? '';
  cells[16] = options.nationality ?? '';
  cells[29] = 'false';
  cells[30] = options.isArtist ? 'true' : 'false';
  cells[32] = options.groups ?? '';
  cells[39] = options.instagramUrl ?? '';
  // Every real data row has a 45th field: the header's "Date Added" position
  // (index 43) is always blank, and the real value lands in this extra field.
  cells.push(options.dateAdded ?? '');
  return cells.map(csvCell).join(',');
}

export interface PieceRowOptions {
  sourcePieceId: number;
  title?: string;
  artistSourceIds?: number[];
  type?: string;
  creationDate?: string;
  collections?: string;
  tags?: string;
  signed?: boolean;
  isPublic?: boolean;
  editionInfo?: string;
  sellerSourceContactId?: number;
  primaryImageUrl?: string;
  additionalImages?: { url: string; caption?: string }[];
  files?: { name: string; notes?: string; url: string }[];
}

export function piecesRow(options: PieceRowOptions): string {
  const cells = new Array(143).fill('');
  cells[0] = String(options.sourcePieceId);
  cells[1] = options.title ?? '';
  cells[5] = (options.artistSourceIds ?? []).join(', ');
  cells[7] = options.type ?? '';
  cells[23] = options.creationDate ?? '';
  cells[29] = options.collections ?? '';
  cells[30] = options.tags ?? '';
  cells[31] = options.signed ? 'true' : '';
  cells[53] = options.editionInfo ?? '';
  cells[59] = options.sellerSourceContactId ? String(options.sellerSourceContactId) : '';
  cells[76] = options.primaryImageUrl ?? '';
  (options.additionalImages ?? []).forEach((image, index) => {
    const urlIndex = 78 + index * 2;
    cells[urlIndex] = image.url;
    cells[urlIndex + 1] = image.caption ?? '';
  });
  cells[140] = options.isPublic ? 'true' : '';
  const fileFields = (options.files ?? []).flatMap((file) => [file.name, file.notes ?? '', file.url]);
  if (fileFields.length > 0) {
    // index 142 is the single reserved "Additional Files" slot when empty;
    // replace it with the real (name, notes, url) triples when files exist.
    cells.splice(142, 1, ...fileFields);
  }
  return cells.map(csvCell).join(',');
}
```

- [ ] **Step 7: Write the failing smoke test for `runImport`**

```typescript
// tests/import/run-import-smoke.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { artworkArtists, artworks, contacts } from '../../src/db/schema';
import { runImport } from '../../scripts/import/run-import';
import { CONTACTS_HEADER, PIECES_HEADER, contactsRow, piecesRow } from './csv-fixture-helpers';

describe('runImport (smoke)', () => {
  it('wires CSV parsing through both import stages end to end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'import-smoke-'));
    const contactsPath = join(dir, 'contacts.csv');
    const piecesPath = join(dir, 'pieces.csv');
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);

    writeFileSync(
      contactsPath,
      `${CONTACTS_HEADER}\n${contactsRow({ sourceContactId, firstName: 'Smoke Test Artist', isArtist: true })}\n`,
    );
    writeFileSync(
      piecesPath,
      `${PIECES_HEADER}\n${piecesRow({ sourcePieceId, title: 'Smoke Test Piece', artistSourceIds: [sourceContactId] })}\n`,
    );

    try {
      const summary = await runImport({ db: testDb, contactsPath, piecesPath });

      expect(summary.contacts.processed).toBe(1);
      expect(summary.artworks.processed).toBe(1);
      expect(summary.artworkArtists.processed).toBe(1);
      expect(summary.skippedMessages).toEqual([]);

      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
      expect(artwork.title).toBe('Smoke Test Piece');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
      if (artwork) {
        await testDb.delete(artworkArtists).where(eq(artworkArtists.artworkId, artwork.id));
      }
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
    }
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `pnpm test -- run-import-smoke`

Expected: FAIL — cannot find module `'../../scripts/import/run-import'`.

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm test -- run-import-smoke`

Expected: PASS (1 test) — no further implementation needed, `run-import.ts` was already written in Step 5.

- [ ] **Step 10: Add the CLI entrypoint**

```typescript
// scripts/import-csv.ts
import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/db/client';
import { runImport } from './import/run-import';
import { printSummary } from './import/summary';

function argPath(flag: string, fallback: string): string {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

const contactsPath = argPath('contacts', path.join(os.homedir(), 'art-collection-data', 'ContactsExport.csv'));
const piecesPath = argPath('pieces', path.join(os.homedir(), 'art-collection-data', 'PiecesExport.csv'));

const summary = await runImport({ db, contactsPath, piecesPath });
printSummary(summary);
```

- [ ] **Step 11: Wire up the `pnpm import:csv` script**

Add to `package.json`'s `"scripts"` object (keep every existing entry as-is):

```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "import:csv": "tsx scripts/import-csv.ts"
  }
}
```

- [ ] **Step 12: Run the full suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add scripts/import/summary.ts scripts/import/run-import.ts scripts/import-csv.ts \
  package.json tests/import/csv-fixture-helpers.ts tests/import/summary.test.ts \
  tests/import/run-import-smoke.test.ts
git commit -m "feat: add import summary, orchestration, and CLI entrypoint"
```

---

## Task 7: End-to-end fixture test, including idempotent re-run

**Files:**
- Test: `tests/import/run-import.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-6 — `runImport` (Task 6), `CONTACTS_HEADER`/`PIECES_HEADER`/`contactsRow`/`piecesRow` (Task 6's `csv-fixture-helpers.ts`), the full schema.
- Produces: nothing new — this is the final verification task. No later task depends on it.

This is the single most load-bearing test in the plan: it's the only place that exercises the full pipeline (`parseCsvFile` → `parseContactsRows`/`parsePiecesRows` → `importContacts`/`importArtworks`) together, and the only place that proves the import is genuinely safe to re-run.

- [ ] **Step 1: Write the end-to-end test**

```typescript
// tests/import/run-import.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import {
  artworkArtists,
  artworkCollections,
  artworkFiles,
  artworkImages,
  artworkTags,
  artworks,
  collections,
  contacts,
  tags,
} from '../../src/db/schema';
import { runImport } from '../../scripts/import/run-import';
import { CONTACTS_HEADER, PIECES_HEADER, contactsRow, piecesRow } from './csv-fixture-helpers';

async function cleanupArtwork(sourcePieceId: number): Promise<void> {
  const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
  if (!artwork) return;
  await testDb.delete(artworkArtists).where(eq(artworkArtists.artworkId, artwork.id));
  await testDb.delete(artworkImages).where(eq(artworkImages.artworkId, artwork.id));
  await testDb.delete(artworkFiles).where(eq(artworkFiles.artworkId, artwork.id));
  await testDb.delete(artworkCollections).where(eq(artworkCollections.artworkId, artwork.id));
  await testDb.delete(artworkTags).where(eq(artworkTags.artworkId, artwork.id));
  await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
}

describe('runImport (end-to-end fixture)', () => {
  it('imports every scenario correctly and is safe to run twice', async () => {
    const adaSourceId = Math.floor(Math.random() * 1_000_000_000);
    const charlesSourceId = Math.floor(Math.random() * 1_000_000_000);
    const gallerySourceId = Math.floor(Math.random() * 1_000_000_000);
    const sellerSourceId = Math.floor(Math.random() * 1_000_000_000);
    const blankSourceId = Math.floor(Math.random() * 1_000_000_000);

    const multiArtistPieceId = Math.floor(Math.random() * 1_000_000_000);
    const multiImagePieceId = Math.floor(Math.random() * 1_000_000_000);
    const multiFilePieceId = Math.floor(Math.random() * 1_000_000_000);
    const blankPieceId = Math.floor(Math.random() * 1_000_000_000);
    const yearMonthPieceId = Math.floor(Math.random() * 1_000_000_000);
    const sellerPieceId = Math.floor(Math.random() * 1_000_000_000);
    const unresolvedArtistPieceId = Math.floor(Math.random() * 1_000_000_000);
    // Randomized rather than fixed literals: tags/collections are globally
    // unique-by-name across the whole test database, and Vitest runs test
    // files in parallel — fixed names here would race with the same fixed
    // names used by Task 4/5's test files.
    const collectionName = `Test Collection ${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
    const tagName = `Test Tag ${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;

    const dir = mkdtempSync(join(tmpdir(), 'import-e2e-'));
    const contactsPath = join(dir, 'contacts.csv');
    const piecesPath = join(dir, 'pieces.csv');

    const contactsCsv =
      [
        CONTACTS_HEADER,
        contactsRow({
          sourceContactId: adaSourceId,
          firstName: 'Ada',
          lastName: 'Lovelace',
          isArtist: true,
          birthDate: '1815',
          nationality: 'British',
        }),
        contactsRow({
          sourceContactId: charlesSourceId,
          firstName: 'Charles',
          lastName: 'Babbage',
          isArtist: true,
          birthDate: '1791-12-26',
          nationality: 'British',
        }),
        contactsRow({ sourceContactId: gallerySourceId, companyName: 'Test Gallery' }),
        contactsRow({ sourceContactId: sellerSourceId, companyName: 'Seller Gallery LLC' }),
        contactsRow({ sourceContactId: blankSourceId }),
      ].join('\n') + '\n';

    const piecesCsv =
      [
        PIECES_HEADER,
        piecesRow({
          sourcePieceId: multiArtistPieceId,
          title: 'Collaborative Piece',
          artistSourceIds: [adaSourceId, charlesSourceId],
        }),
        piecesRow({
          sourcePieceId: multiImagePieceId,
          title: 'Multi Image Piece',
          artistSourceIds: [adaSourceId],
          primaryImageUrl: 'https://example.com/primary.jpg',
          additionalImages: [{ url: 'https://example.com/additional-1.jpg', caption: 'side view' }],
          editionInfo: 'unnumbered of 25\nartist proof',
          collections: collectionName,
          tags: tagName,
        }),
        piecesRow({
          sourcePieceId: multiFilePieceId,
          title: 'Multi File Piece',
          artistSourceIds: [adaSourceId],
          files: [
            { name: 'Front', url: 'https://example.com/front.jpg' },
            { name: 'Back', url: 'https://example.com/back.jpg' },
          ],
        }),
        piecesRow({ sourcePieceId: blankPieceId, title: 'Blank Piece', artistSourceIds: [adaSourceId] }),
        piecesRow({
          sourcePieceId: yearMonthPieceId,
          title: 'Year Month Piece',
          artistSourceIds: [adaSourceId],
          creationDate: '2017-06',
        }),
        piecesRow({
          sourcePieceId: sellerPieceId,
          title: 'Seller Piece',
          artistSourceIds: [adaSourceId],
          sellerSourceContactId: sellerSourceId,
        }),
        piecesRow({
          sourcePieceId: unresolvedArtistPieceId,
          title: 'Unresolved Artist Piece',
          artistSourceIds: [999_999_999],
        }),
      ].join('\n') + '\n';

    writeFileSync(contactsPath, contactsCsv);
    writeFileSync(piecesPath, piecesCsv);

    try {
      const summary = await runImport({ db: testDb, contactsPath, piecesPath });

      expect(summary.contacts.processed).toBe(5);
      expect(summary.artworks.processed).toBe(7);
      expect(summary.skippedMessages).toEqual([]);

      // Multi-artist piece: two artwork_artists rows with correct roles.
      const [multiArtist] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, multiArtistPieceId));
      const artistLinks = await testDb
        .select()
        .from(artworkArtists)
        .where(eq(artworkArtists.artworkId, multiArtist.id));
      const [ada] = await testDb.select().from(contacts).where(eq(contacts.sourceContactId, adaSourceId));
      const [charles] = await testDb.select().from(contacts).where(eq(contacts.sourceContactId, charlesSourceId));
      expect(artistLinks.find((l) => l.contactId === ada.id)?.role).toBe('primary');
      expect(artistLinks.find((l) => l.contactId === charles.id)?.role).toBe('additional');
      expect(ada.birthDate).toBe('1815-01-01');
      expect(charles.birthDate).toBe('1791-12-26');

      // Multi-image piece: both images present, r2Key null, sourceUrl set, edition
      // info survived the embedded newline (collapsed to a single space by cleanText).
      const [multiImage] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, multiImagePieceId));
      const images = await testDb.select().from(artworkImages).where(eq(artworkImages.artworkId, multiImage.id));
      expect(images).toHaveLength(2);
      expect(images.find((i) => i.isPrimary)?.sourceUrl).toBe('https://example.com/primary.jpg');
      expect(images.find((i) => !i.isPrimary)?.sourceUrl).toBe('https://example.com/additional-1.jpg');
      expect(images.every((i) => i.r2Key === null)).toBe(true);
      expect(multiImage.editionInfo).toBe('unnumbered of 25 artist proof');
      const multiImageCollectionLinks = await testDb
        .select()
        .from(artworkCollections)
        .where(eq(artworkCollections.artworkId, multiImage.id));
      const multiImageTagLinks = await testDb
        .select()
        .from(artworkTags)
        .where(eq(artworkTags.artworkId, multiImage.id));
      expect(multiImageCollectionLinks).toHaveLength(1);
      expect(multiImageTagLinks).toHaveLength(1);

      // Multi-file piece: both files present, chunked correctly, r2Key null.
      const [multiFile] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, multiFilePieceId));
      const files = await testDb.select().from(artworkFiles).where(eq(artworkFiles.artworkId, multiFile.id));
      expect(files).toHaveLength(2);
      expect(files.find((f) => f.name === 'Front')?.sourceUrl).toBe('https://example.com/front.jpg');
      expect(files.find((f) => f.name === 'Back')?.sourceUrl).toBe('https://example.com/back.jpg');
      expect(files.every((f) => f.r2Key === null)).toBe(true);

      // Blank piece: zero images/files does not crash and produces zero rows.
      const [blank] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, blankPieceId));
      expect(await testDb.select().from(artworkImages).where(eq(artworkImages.artworkId, blank.id))).toHaveLength(0);
      expect(await testDb.select().from(artworkFiles).where(eq(artworkFiles.artworkId, blank.id))).toHaveLength(0);

      // Year-month creation date extracts the leading year.
      const [yearMonth] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, yearMonthPieceId));
      expect(yearMonth.creationYear).toBe(2017);

      // Seller piece resolves sellerContactId to the internal id.
      const [sellerPiece] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, sellerPieceId));
      const [seller] = await testDb.select().from(contacts).where(eq(contacts.sourceContactId, sellerSourceId));
      expect(sellerPiece.sellerContactId).toBe(seller.id);

      // Unresolved artist id: artwork still created, zero artist links, warning logged.
      const [unresolved] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, unresolvedArtistPieceId));
      const unresolvedLinks = await testDb
        .select()
        .from(artworkArtists)
        .where(eq(artworkArtists.artworkId, unresolved.id));
      expect(unresolvedLinks).toHaveLength(0);
      expect(summary.warningMessages.some((m) => m.includes('artist id 999999999 not found in contacts'))).toBe(
        true,
      );

      // --- Idempotency: re-running with identical input must not duplicate anything. ---
      await runImport({ db: testDb, contactsPath, piecesPath });

      const contactRows = await testDb.select().from(contacts).where(eq(contacts.sourceContactId, adaSourceId));
      expect(contactRows).toHaveLength(1);

      const artworkRows = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, multiArtistPieceId));
      expect(artworkRows).toHaveLength(1);

      const artistLinksAfter = await testDb
        .select()
        .from(artworkArtists)
        .where(eq(artworkArtists.artworkId, multiArtist.id));
      expect(artistLinksAfter).toHaveLength(2);

      const imagesAfter = await testDb.select().from(artworkImages).where(eq(artworkImages.artworkId, multiImage.id));
      expect(imagesAfter).toHaveLength(2);

      const filesAfter = await testDb.select().from(artworkFiles).where(eq(artworkFiles.artworkId, multiFile.id));
      expect(filesAfter).toHaveLength(2);

      const collectionLinksAfter = await testDb
        .select()
        .from(artworkCollections)
        .where(eq(artworkCollections.artworkId, multiImage.id));
      expect(collectionLinksAfter).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await cleanupArtwork(multiArtistPieceId);
      await cleanupArtwork(multiImagePieceId);
      await cleanupArtwork(multiFilePieceId);
      await cleanupArtwork(blankPieceId);
      await cleanupArtwork(yearMonthPieceId);
      await cleanupArtwork(sellerPieceId);
      await cleanupArtwork(unresolvedArtistPieceId);
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, adaSourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, charlesSourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, gallerySourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sellerSourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, blankSourceId));
      await testDb.delete(collections).where(eq(collections.name, collectionName));
      await testDb.delete(tags).where(eq(tags.name, tagName));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- import/run-import.test`

Expected: This should already PASS if Tasks 1-6 were implemented correctly, since every piece it depends on already exists — this test's purpose is end-to-end verification, not driving new implementation (there's no new production code left to write). If it fails, the failure points at an integration bug between modules that the per-module tests in Tasks 3-6 didn't catch (e.g. a field name mismatch between what `parsePiecesRows` produces and what `importArtworks` expects) — fix the bug in the relevant module before proceeding, following that module's existing patterns.

- [ ] **Step 3: Run the full suite one final time**

Run: `pnpm test`

Expected: PASS — every test in the project, including this one.

- [ ] **Step 4: Confirm the prod client is never imported outside the CLI entrypoint**

Run: `grep -rn "from '.*src/db/client'" scripts/import tests/import`

Expected: no output (the only import of `src/db/client` in the whole `scripts/` tree is the value import in `scripts/import-csv.ts`, which is outside both searched directories).

- [ ] **Step 5: Commit**

```bash
git add tests/import/run-import.test.ts
git commit -m "test: add end-to-end CSV import fixture test with idempotent re-run"
```

---

## Out of Scope (matches the approved design)

- Running the import against the real `ART_COLLECTION_POSTGRES` database with the real 906/510-row CSVs — a deliberate manual follow-up.
- R2 image/file upload — `sourceUrl` is populated, `r2Key` stays null until a future phase implements the upload.
- Frontend pages, Tailwind styling, Cloudflare deployment.
