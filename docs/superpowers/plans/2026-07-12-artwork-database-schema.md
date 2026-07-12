# Artwork Database Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Postgres schema (via Drizzle + Neon) described in `docs/superpowers/specs/2026-07-12-artwork-database-schema-design.md`, with migrations generated from the schema and integration tests proving each table (and its constraints/relationships) works against a real Neon database.

**Architecture:** Drizzle schema files under `src/db/schema/`, one file per table group, re-exported from a single `src/db/schema/index.ts` barrel. `drizzle-kit` generates SQL migrations from these files into `./drizzle`. A Neon HTTP client (`drizzle-orm/neon-http`) is used both for the app's runtime DB client and for tests, since it works identically in Node (tests, scripts) and Cloudflare Workers (future runtime) without needing a TCP driver. Tests run against a dedicated test database so they never touch real collection data; Vitest's `globalSetup` applies pending migrations to that test database once before the whole test run.

**Tech Stack:** Astro, TypeScript, Drizzle ORM (`drizzle-orm`, `drizzle-kit`), `@neondatabase/serverless`, Neon Postgres, Vitest, `dotenv`.

## Global Constraints

- Database connection string for the dev/prod database is read from `ART_COLLECTION_POSTGRES` (per `docs/SPEC.md`).
- A separate test database connection string is read from `ART_COLLECTION_TEST_DB` — tests must never run against `ART_COLLECTION_POSTGRES`.
- Schema/table/column decisions must match `docs/superpowers/specs/2026-07-12-artwork-database-schema-design.md` exactly — this plan implements that spec, it doesn't redesign it.
- Node >=22.12.0, pnpm, ESM (`"type": "module"` in `package.json`).

---

## Before You Start

This plan assumes:
1. You have a Neon Postgres database already provisioned for dev/prod use, and its connection string.
2. You have (or will create) a **second, separate** Neon database purely for running tests, and its connection string.
3. Both connection strings go in a `.env` file at the repo root (already gitignored):

```
ART_COLLECTION_POSTGRES=postgresql://...
ART_COLLECTION_TEST_DB=postgresql://...
```

Neon connection strings look like `postgresql://user:password@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require`. You can create a second database for free within the same Neon project (Neon projects support multiple databases, or you can use a separate branch) — either satisfies "separate test database" here.

---

### Task 1: Project setup — dependencies, Drizzle config, DB clients, test infrastructure

**Files:**
- Modify: `package.json`
- Create: `drizzle.config.ts`
- Create: `src/db/schema/index.ts`
- Create: `src/db/client.ts`
- Create: `tests/helpers/test-db.ts`
- Create: `tests/global-setup.ts`
- Create: `tests/setup.ts`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Test: `tests/db/connection.test.ts`

**Interfaces:**
- Produces: `db` (exported from `src/db/client.ts`) — a `drizzle-orm/neon-http` instance configured with `schema` from `src/db/schema/index.ts`, for use by app code later.
- Produces: `testDb` (exported from `tests/helpers/test-db.ts`) — same shape, pointed at `ART_COLLECTION_TEST_DB`, for use by every test in later tasks.
- Produces: `src/db/schema/index.ts` — an empty barrel file that later tasks add `export * from './<table-file>'` lines to. Every later task's schema file gets re-exported here.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add drizzle-orm @neondatabase/serverless
pnpm add -D drizzle-kit vitest dotenv
```

- [ ] **Step 2: Add npm scripts to `package.json`**

Add these entries to the existing `"scripts"` object (keep the existing `dev`, `build`, `preview`, `astro` entries as-is):

```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  }
}
```

- [ ] **Step 3: Create `.env.example`**

```
ART_COLLECTION_POSTGRES=postgresql://user:password@host/dbname?sslmode=require
ART_COLLECTION_TEST_DB=postgresql://user:password@host/test_dbname?sslmode=require
```

- [ ] **Step 4: Create the empty schema barrel**

```typescript
// src/db/schema/index.ts
export {};
```

- [ ] **Step 5: Create `drizzle.config.ts`**

```typescript
// drizzle.config.ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.ART_COLLECTION_POSTGRES) {
  throw new Error('ART_COLLECTION_POSTGRES environment variable is not set');
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.ART_COLLECTION_POSTGRES,
  },
});
```

- [ ] **Step 6: Create the app's runtime DB client**

```typescript
// src/db/client.ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const connectionString = process.env.ART_COLLECTION_POSTGRES;

if (!connectionString) {
  throw new Error('ART_COLLECTION_POSTGRES environment variable is not set');
}

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
```

- [ ] **Step 7: Create the test DB client**

```typescript
// tests/helpers/test-db.ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../../src/db/schema';

const connectionString = process.env.ART_COLLECTION_TEST_DB;

if (!connectionString) {
  throw new Error('ART_COLLECTION_TEST_DB environment variable is not set');
}

const sql = neon(connectionString);

export const testDb = drizzle(sql, { schema });
```

- [ ] **Step 8: Create the Vitest global setup that migrates the test database**

```typescript
// tests/global-setup.ts
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

export async function setup() {
  const connectionString = process.env.ART_COLLECTION_TEST_DB;

  if (!connectionString) {
    throw new Error('ART_COLLECTION_TEST_DB environment variable is not set');
  }

  const sql = neon(connectionString);
  const db = drizzle(sql);

  await migrate(db, { migrationsFolder: './drizzle' });
}
```

- [ ] **Step 9: Create the per-test-file setup that loads `.env`**

```typescript
// tests/setup.ts
import 'dotenv/config';
```

- [ ] **Step 10: Create `vitest.config.ts`**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
```

- [ ] **Step 11: Write the failing smoke test**

```typescript
// tests/db/connection.test.ts
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';

describe('database connection', () => {
  it('connects to the test database', async () => {
    const result = await testDb.execute(sql`select 1 as value`);

    expect(Number(result.rows[0].value)).toBe(1);
  });
});
```

- [ ] **Step 12: Run the test to verify your `.env` values actually work**

Run: `pnpm test`

Expected: PASS (`database connection > connects to the test database`). This is deliberately a real connectivity check, not a unit that fails first — its purpose is to confirm `ART_COLLECTION_TEST_DB` is valid before any schema work begins. If it fails, fix your `.env` before continuing.

- [ ] **Step 13: Commit**

```bash
git add package.json pnpm-lock.yaml drizzle.config.ts vitest.config.ts .env.example \
  src/db/schema/index.ts src/db/client.ts tests/helpers/test-db.ts \
  tests/global-setup.ts tests/setup.ts tests/db/connection.test.ts
git commit -m "chore: set up Drizzle, Neon client, and test database infrastructure"
```

---

### Task 2: `contacts` table

**Files:**
- Create: `src/db/schema/contacts.ts`
- Modify: `src/db/schema/index.ts`
- Test: `tests/db/contacts.test.ts`

**Interfaces:**
- Consumes: nothing from other tables (this is the first real table).
- Produces: `contacts` (Drizzle table object, exported from `src/db/schema/contacts.ts` and re-exported via `src/db/schema/index.ts`) — columns: `id`, `sourceContactId`, `title`, `firstName`, `lastName`, `email`, `secondaryEmail`, `jobTitle`, `companyName`, `workPhone`, `phone`, `mobilePhone`, `website`, `birthDate`, `deathDate`, `nationality`, `address1`, `address2`, `city`, `state`, `zip`, `country`, `secondaryAddress1`, `secondaryAddress2`, `secondaryCity`, `secondaryState`, `secondaryZip`, `secondaryCountry`, `isArtist`, `bio`, `notes`, `location`, `sourceLocationId`, `instagramUrl`, `dateAdded`. Later tasks (`artworks`, `artwork_artists`, `contact_tags`, `contact_groups`) reference `contacts.id`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/contacts.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { contacts } from '../../src/db/schema';

describe('contacts table', () => {
  it('inserts and reads back a contact', async () => {
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);

    try {
      const [inserted] = await testDb
        .insert(contacts)
        .values({
          sourceContactId,
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          isArtist: true,
          instagramUrl: 'https://instagram.com/ada',
        })
        .returning();

      expect(inserted.firstName).toBe('Ada');
      expect(inserted.isArtist).toBe(true);

      const [found] = await testDb
        .select()
        .from(contacts)
        .where(eq(contacts.id, inserted.id));

      expect(found.lastName).toBe('Lovelace');
      expect(found.sourceContactId).toBe(sourceContactId);
    } finally {
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
    }
  });

  it('defaults isArtist to false when not provided', async () => {
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);

    try {
      const [inserted] = await testDb
        .insert(contacts)
        .values({ sourceContactId, companyName: 'Some Gallery' })
        .returning();

      expect(inserted.isArtist).toBe(false);
    } finally {
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- contacts`

Expected: FAIL — module `'../../src/db/schema'` has no exported member `contacts` (TypeScript error) or, if that's not caught first, a Postgres error that relation `"contacts"` does not exist.

- [ ] **Step 3: Write the schema**

```typescript
// src/db/schema/contacts.ts
import { boolean, date, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  sourceContactId: integer('source_contact_id').unique(),
  title: text('title'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  email: text('email'),
  secondaryEmail: text('secondary_email'),
  jobTitle: text('job_title'),
  companyName: text('company_name'),
  workPhone: text('work_phone'),
  phone: text('phone'),
  mobilePhone: text('mobile_phone'),
  website: text('website'),
  birthDate: date('birth_date'),
  deathDate: date('death_date'),
  nationality: text('nationality'),
  address1: text('address1'),
  address2: text('address2'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  country: text('country'),
  secondaryAddress1: text('secondary_address1'),
  secondaryAddress2: text('secondary_address2'),
  secondaryCity: text('secondary_city'),
  secondaryState: text('secondary_state'),
  secondaryZip: text('secondary_zip'),
  secondaryCountry: text('secondary_country'),
  isArtist: boolean('is_artist').notNull().default(false),
  bio: text('bio'),
  notes: text('notes'),
  location: text('location'),
  sourceLocationId: integer('source_location_id'),
  instagramUrl: text('instagram_url'),
  dateAdded: date('date_added'),
});
```

- [ ] **Step 4: Re-export it from the schema barrel**

```typescript
// src/db/schema/index.ts
export * from './contacts';
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm db:generate`

Expected: a new SQL file appears under `./drizzle` (e.g. `0000_<generated-name>.sql`) containing `CREATE TABLE "contacts" (...)`.

- [ ] **Step 6: Apply the migration to the dev database**

Run: `pnpm db:migrate`

Expected: output confirming the migration was applied (no errors).

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test -- contacts`

Expected: PASS (2 tests) — Vitest's `globalSetup` applies the same migration to `ART_COLLECTION_TEST_DB` automatically before the run.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/contacts.ts src/db/schema/index.ts tests/db/contacts.test.ts drizzle
git commit -m "feat: add contacts table"
```

---

### Task 3: Lookup tables — `tags`, `groups`, `collections`

**Files:**
- Create: `src/db/schema/lookups.ts`
- Modify: `src/db/schema/index.ts`
- Test: `tests/db/lookups.test.ts`

**Interfaces:**
- Consumes: nothing (these are standalone lookup tables).
- Produces: `tags`, `groups`, `collections` (Drizzle table objects, exported from `src/db/schema/lookups.ts`) — each has `id` (serial PK) and `name` (text, not null, unique). Later tasks (`artwork_tags`, `contact_tags`, `artwork_collections`, `contact_groups`) reference `tags.id`, `groups.id`, `collections.id`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/lookups.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { collections, groups, tags } from '../../src/db/schema';

describe('lookup tables', () => {
  it('inserts and reads back a tag, a group, and a collection', async () => {
    const suffix = Date.now();
    const tagName = `test-tag-${suffix}`;
    const groupName = `test-group-${suffix}`;
    const collectionName = `test-collection-${suffix}`;

    try {
      const [tag] = await testDb.insert(tags).values({ name: tagName }).returning();
      const [group] = await testDb.insert(groups).values({ name: groupName }).returning();
      const [collection] = await testDb
        .insert(collections)
        .values({ name: collectionName })
        .returning();

      expect(tag.name).toBe(tagName);
      expect(group.name).toBe(groupName);
      expect(collection.name).toBe(collectionName);
    } finally {
      await testDb.delete(tags).where(eq(tags.name, tagName));
      await testDb.delete(groups).where(eq(groups.name, groupName));
      await testDb.delete(collections).where(eq(collections.name, collectionName));
    }
  });

  it('rejects a duplicate tag name', async () => {
    const tagName = `dup-tag-${Date.now()}`;

    try {
      await testDb.insert(tags).values({ name: tagName });

      await expect(testDb.insert(tags).values({ name: tagName })).rejects.toThrow();
    } finally {
      await testDb.delete(tags).where(eq(tags.name, tagName));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- lookups`

Expected: FAIL — no exported member `tags`/`groups`/`collections` from the schema module.

- [ ] **Step 3: Write the schema**

```typescript
// src/db/schema/lookups.ts
import { pgTable, serial, text } from 'drizzle-orm/pg-core';

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const collections = pgTable('collections', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
});
```

- [ ] **Step 4: Re-export it from the schema barrel**

```typescript
// src/db/schema/index.ts
export * from './contacts';
export * from './lookups';
```

- [ ] **Step 5: Generate and apply the migration**

Run: `pnpm db:generate && pnpm db:migrate`

Expected: a new migration file with three `CREATE TABLE` statements; `db:migrate` reports success.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- lookups`

Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/lookups.ts src/db/schema/index.ts tests/db/lookups.test.ts drizzle
git commit -m "feat: add tags, groups, and collections lookup tables"
```

---

### Task 4: `artworks` table

**Files:**
- Create: `src/db/schema/artworks.ts`
- Modify: `src/db/schema/index.ts`
- Test: `tests/db/artworks.test.ts`

**Interfaces:**
- Consumes: `contacts` table from Task 2 (`src/db/schema/contacts.ts`) — `sellerContactId` references `contacts.id`.
- Produces: `artworks` (Drizzle table object) — columns as listed below. Later tasks (`artwork_artists`, `artwork_images`, `artwork_files`, `artwork_collections`, `artwork_tags`) reference `artworks.id`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/artworks.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { artworks, contacts } from '../../src/db/schema';

describe('artworks table', () => {
  it('inserts an artwork with a seller contact and reads it back', async () => {
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);

    try {
      const [seller] = await testDb
        .insert(contacts)
        .values({ sourceContactId, companyName: 'Test Gallery' })
        .returning();

      const [artwork] = await testDb
        .insert(artworks)
        .values({
          sourcePieceId,
          title: 'Test Piece',
          type: 'Painting',
          isPublic: true,
          sellerContactId: seller.id,
          provenanceNotes: 'Purchased directly from the artist in 2020.',
        })
        .returning();

      expect(artwork.title).toBe('Test Piece');
      expect(artwork.isPublic).toBe(true);
      expect(artwork.framed).toBe(false);
      expect(artwork.sellerContactId).toBe(seller.id);

      const [found] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.id, artwork.id));

      expect(found.provenanceNotes).toBe('Purchased directly from the artist in 2020.');
    } finally {
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
    }
  });

  it('rejects an artwork referencing a nonexistent seller contact', async () => {
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);
    const bogusContactId = 999_999_999;

    await expect(
      testDb.insert(artworks).values({
        sourcePieceId,
        title: 'Bad Reference',
        sellerContactId: bogusContactId,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- artworks`

Expected: FAIL — no exported member `artworks` from the schema module.

- [ ] **Step 3: Write the schema**

```typescript
// src/db/schema/artworks.ts
import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { contacts } from './contacts';

export const artworks = pgTable('artworks', {
  id: serial('id').primaryKey(),
  sourcePieceId: integer('source_piece_id').unique(),
  title: text('title'),
  inventoryNumber: text('inventory_number'),
  type: text('type'),
  medium: text('medium'),
  subjectMatter: text('subject_matter'),
  height: numeric('height'),
  width: numeric('width'),
  depth: numeric('depth'),
  dimensionOverride: text('dimension_override'),
  weight: numeric('weight'),
  framed: boolean('framed').notNull().default(false),
  framedHeight: numeric('framed_height'),
  framedWidth: numeric('framed_width'),
  framedDepth: numeric('framed_depth'),
  paperHeight: numeric('paper_height'),
  paperWidth: numeric('paper_width'),
  creationYear: integer('creation_year'),
  creationDateCirca: boolean('creation_date_circa').notNull().default(false),
  creationDateOverride: text('creation_date_override'),
  description: text('description'),
  notes: text('notes'),
  signed: boolean('signed').notNull().default(false),
  signatureNotes: text('signature_notes'),
  condition: text('condition'),
  conditionNotes: text('condition_notes'),
  edition: text('edition'),
  editionInfo: text('edition_info'),
  attribution: text('attribution'),
  isPublic: boolean('is_public').notNull().default(false),
  purchaseDate: date('purchase_date'),
  purchasePrice: numeric('purchase_price'),
  purchaseCurrency: text('purchase_currency'),
  sourcePurchaseLocationId: integer('source_purchase_location_id'),
  purchaseLocationName: text('purchase_location_name'),
  sellerContactId: integer('seller_contact_id').references(() => contacts.id),
  purchaseUrl: text('purchase_url'),
  fairMarketValue: numeric('fair_market_value'),
  insuranceValue: numeric('insurance_value'),
  provenanceNotes: text('provenance_notes'),
  source: text('source'),
  currentLocationName: text('current_location_name'),
  sourceCurrentLocationId: integer('source_current_location_id'),
  currentSubLocationName: text('current_sub_location_name'),
  currentTertiaryLocationName: text('current_tertiary_location_name'),
  currentLocationStartDate: date('current_location_start_date'),
  currentLocationEndDate: date('current_location_end_date'),
  currentLocationNotes: text('current_location_notes'),
  currentLocationLatitude: numeric('current_location_latitude'),
  currentLocationLongitude: numeric('current_location_longitude'),
  lastUpdated: timestamp('last_updated'),
  lastUpdatedBy: text('last_updated_by'),
  dateAdded: date('date_added'),
});
```

- [ ] **Step 4: Re-export it from the schema barrel**

```typescript
// src/db/schema/index.ts
export * from './contacts';
export * from './lookups';
export * from './artworks';
```

- [ ] **Step 5: Generate and apply the migration**

Run: `pnpm db:generate && pnpm db:migrate`

Expected: a new migration file with `CREATE TABLE "artworks"` including a foreign key on `seller_contact_id`; `db:migrate` reports success.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- artworks`

Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/artworks.ts src/db/schema/index.ts tests/db/artworks.test.ts drizzle
git commit -m "feat: add artworks table"
```

---

### Task 5: Artwork-specific relations — `artwork_artists`, `artwork_images`, `artwork_files`

**Files:**
- Create: `src/db/schema/artwork-artists.ts`
- Create: `src/db/schema/artwork-images.ts`
- Create: `src/db/schema/artwork-files.ts`
- Modify: `src/db/schema/index.ts`
- Test: `tests/db/artwork-relations.test.ts`

**Interfaces:**
- Consumes: `artworks` (Task 4) and `contacts` (Task 2).
- Produces: `artworkArtists`, `artworkArtistRole` (pg enum: `'primary' | 'additional'`), `artworkImages`, `artworkFiles` — all exported from their respective files and re-exported via the barrel. No later task depends on these directly, but Task 6's integration test uses `artworkArtists` and `artworkImages` alongside its own tables.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/artwork-relations.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { artworkArtists, artworkFiles, artworkImages, artworks, contacts } from '../../src/db/schema';

describe('artwork relation tables', () => {
  it('links an artwork to an artist, an image, and a file', async () => {
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);

    try {
      const [artist] = await testDb
        .insert(contacts)
        .values({ sourceContactId, firstName: 'Ada', lastName: 'Lovelace', isArtist: true })
        .returning();

      const [artwork] = await testDb
        .insert(artworks)
        .values({ sourcePieceId, title: 'Collaborative Piece' })
        .returning();

      await testDb.insert(artworkArtists).values({
        artworkId: artwork.id,
        contactId: artist.id,
        role: 'primary',
        sortOrder: 0,
      });

      const [image] = await testDb
        .insert(artworkImages)
        .values({
          artworkId: artwork.id,
          r2Key: 'artworks/test/primary.jpg',
          isPrimary: true,
          sortOrder: 0,
        })
        .returning();

      const [file] = await testDb
        .insert(artworkFiles)
        .values({
          artworkId: artwork.id,
          name: 'Certificate of Authenticity',
          r2Key: 'artworks/test/coa.pdf',
          sortOrder: 0,
        })
        .returning();

      const linkedArtists = await testDb
        .select()
        .from(artworkArtists)
        .where(eq(artworkArtists.artworkId, artwork.id));

      expect(linkedArtists).toHaveLength(1);
      expect(linkedArtists[0].role).toBe('primary');
      expect(image.isPrimary).toBe(true);
      expect(file.name).toBe('Certificate of Authenticity');
    } finally {
      await testDb.delete(artworkFiles).where(eq(artworkFiles.artworkId, artwork!.id));
      await testDb.delete(artworkImages).where(eq(artworkImages.artworkId, artwork!.id));
      await testDb.delete(artworkArtists).where(eq(artworkArtists.artworkId, artwork!.id));
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
    }
  });

  it('rejects an artwork_artists role outside primary/additional', async () => {
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);

    try {
      const [artist] = await testDb
        .insert(contacts)
        .values({ sourceContactId, firstName: 'Ada', lastName: 'Lovelace', isArtist: true })
        .returning();

      const [artwork] = await testDb
        .insert(artworks)
        .values({ sourcePieceId, title: 'Collaborative Piece' })
        .returning();

      await expect(
        testDb.insert(artworkArtists).values({
          artworkId: artwork.id,
          contactId: artist.id,
          // @ts-expect-error intentionally invalid role to test the DB enum constraint
          role: 'co-artist',
        }),
      ).rejects.toThrow();
    } finally {
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
    }
  });
});
```

Note: the cleanup in the `finally` block of the first test uses `artwork!.id` because `artwork` is declared with `const` inside the `try`; TypeScript needs the non-null assertion since it can't see that the `finally` block only runs after assignment succeeds. This mirrors the pattern used in earlier task tests, just with more rows to clean up.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- artwork-relations`

Expected: FAIL — no exported members `artworkArtists`/`artworkImages`/`artworkFiles`.

- [ ] **Step 3: Write the `artwork_artists` schema**

```typescript
// src/db/schema/artwork-artists.ts
import { integer, pgEnum, pgTable, primaryKey } from 'drizzle-orm/pg-core';
import { artworks } from './artworks';
import { contacts } from './contacts';

export const artworkArtistRole = pgEnum('artwork_artist_role', ['primary', 'additional']);

export const artworkArtists = pgTable(
  'artwork_artists',
  {
    artworkId: integer('artwork_id')
      .notNull()
      .references(() => artworks.id),
    contactId: integer('contact_id')
      .notNull()
      .references(() => contacts.id),
    role: artworkArtistRole('role').notNull(),
    sortOrder: integer('sort_order'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.artworkId, table.contactId] }),
  }),
);
```

- [ ] **Step 4: Write the `artwork_images` schema**

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
  caption: text('caption'),
  sortOrder: integer('sort_order'),
  isPrimary: boolean('is_primary').notNull().default(false),
});
```

- [ ] **Step 5: Write the `artwork_files` schema**

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
  sortOrder: integer('sort_order'),
});
```

- [ ] **Step 6: Re-export from the schema barrel**

```typescript
// src/db/schema/index.ts
export * from './contacts';
export * from './lookups';
export * from './artworks';
export * from './artwork-artists';
export * from './artwork-images';
export * from './artwork-files';
```

- [ ] **Step 7: Generate and apply the migration**

Run: `pnpm db:generate && pnpm db:migrate`

Expected: a new migration file creating the `artwork_artist_role` enum and the three tables, with foreign keys to `artworks` and `contacts`; `db:migrate` reports success.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test -- artwork-relations`

Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add src/db/schema/artwork-artists.ts src/db/schema/artwork-images.ts \
  src/db/schema/artwork-files.ts src/db/schema/index.ts \
  tests/db/artwork-relations.test.ts drizzle
git commit -m "feat: add artwork_artists, artwork_images, and artwork_files tables"
```

---

### Task 6: Cross-cutting join tables — `artwork_collections`, `artwork_tags`, `contact_tags`, `contact_groups`

**Files:**
- Create: `src/db/schema/joins.ts`
- Modify: `src/db/schema/index.ts`
- Test: `tests/db/joins.test.ts`

**Interfaces:**
- Consumes: `artworks` (Task 4), `contacts` (Task 2), `tags`/`groups`/`collections` (Task 3).
- Produces: `artworkCollections`, `artworkTags`, `contactTags`, `contactGroups` — the last tables in the schema. This task's test also exercises the full graph (artwork + artist + image + tags + collection + contact + group) as the final proof the schema matches the design doc end-to-end.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/joins.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import {
  artworkArtists,
  artworkCollections,
  artworkTags,
  artworks,
  collections,
  contactGroups,
  contactTags,
  contacts,
  groups,
  tags,
} from '../../src/db/schema';

describe('cross-cutting join tables', () => {
  it('links an artwork to a collection and a tag, and a contact to a tag and a group', async () => {
    const suffix = Date.now();
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);
    const tagName = `test-tag-${suffix}`;
    const groupName = `test-group-${suffix}`;
    const collectionName = `test-collection-${suffix}`;

    try {
      const [artist] = await testDb
        .insert(contacts)
        .values({ sourceContactId, firstName: 'Ada', lastName: 'Lovelace', isArtist: true })
        .returning();

      const [artwork] = await testDb
        .insert(artworks)
        .values({ sourcePieceId, title: 'Fully Linked Piece' })
        .returning();

      await testDb.insert(artworkArtists).values({
        artworkId: artwork.id,
        contactId: artist.id,
        role: 'primary',
      });

      const [tag] = await testDb.insert(tags).values({ name: tagName }).returning();
      const [group] = await testDb.insert(groups).values({ name: groupName }).returning();
      const [collection] = await testDb
        .insert(collections)
        .values({ name: collectionName })
        .returning();

      await testDb.insert(artworkTags).values({ artworkId: artwork.id, tagId: tag.id });
      await testDb
        .insert(artworkCollections)
        .values({ artworkId: artwork.id, collectionId: collection.id });
      await testDb.insert(contactTags).values({ contactId: artist.id, tagId: tag.id });
      await testDb.insert(contactGroups).values({ contactId: artist.id, groupId: group.id });

      const artworkTagLinks = await testDb
        .select()
        .from(artworkTags)
        .where(eq(artworkTags.artworkId, artwork.id));
      const artworkCollectionLinks = await testDb
        .select()
        .from(artworkCollections)
        .where(eq(artworkCollections.artworkId, artwork.id));
      const contactTagLinks = await testDb
        .select()
        .from(contactTags)
        .where(eq(contactTags.contactId, artist.id));
      const contactGroupLinks = await testDb
        .select()
        .from(contactGroups)
        .where(eq(contactGroups.contactId, artist.id));

      expect(artworkTagLinks).toHaveLength(1);
      expect(artworkCollectionLinks).toHaveLength(1);
      expect(contactTagLinks).toHaveLength(1);
      expect(contactGroupLinks).toHaveLength(1);
    } finally {
      await testDb.delete(artworkTags).where(eq(artworkTags.artworkId, artwork!.id));
      await testDb.delete(artworkCollections).where(eq(artworkCollections.artworkId, artwork!.id));
      await testDb.delete(contactTags).where(eq(contactTags.contactId, artist!.id));
      await testDb.delete(contactGroups).where(eq(contactGroups.contactId, artist!.id));
      await testDb.delete(artworkArtists).where(eq(artworkArtists.artworkId, artwork!.id));
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
      await testDb.delete(tags).where(eq(tags.name, tagName));
      await testDb.delete(groups).where(eq(groups.name, groupName));
      await testDb.delete(collections).where(eq(collections.name, collectionName));
    }
  });
});
```

Note: as in Task 5, `artwork!.id` / `artist!.id` in the `finally` block use the non-null assertion because TypeScript can't infer that `finally` only runs after those `const`s are assigned.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- joins`

Expected: FAIL — no exported members `artworkCollections`/`artworkTags`/`contactTags`/`contactGroups`.

- [ ] **Step 3: Write the schema**

```typescript
// src/db/schema/joins.ts
import { integer, pgTable, primaryKey } from 'drizzle-orm/pg-core';
import { artworks } from './artworks';
import { contacts } from './contacts';
import { collections, groups, tags } from './lookups';

export const artworkCollections = pgTable(
  'artwork_collections',
  {
    artworkId: integer('artwork_id')
      .notNull()
      .references(() => artworks.id),
    collectionId: integer('collection_id')
      .notNull()
      .references(() => collections.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.artworkId, table.collectionId] }),
  }),
);

export const artworkTags = pgTable(
  'artwork_tags',
  {
    artworkId: integer('artwork_id')
      .notNull()
      .references(() => artworks.id),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.artworkId, table.tagId] }),
  }),
);

export const contactTags = pgTable(
  'contact_tags',
  {
    contactId: integer('contact_id')
      .notNull()
      .references(() => contacts.id),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.contactId, table.tagId] }),
  }),
);

export const contactGroups = pgTable(
  'contact_groups',
  {
    contactId: integer('contact_id')
      .notNull()
      .references(() => contacts.id),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.contactId, table.groupId] }),
  }),
);
```

- [ ] **Step 4: Re-export from the schema barrel**

```typescript
// src/db/schema/index.ts
export * from './contacts';
export * from './lookups';
export * from './artworks';
export * from './artwork-artists';
export * from './artwork-images';
export * from './artwork-files';
export * from './joins';
```

- [ ] **Step 5: Generate and apply the migration**

Run: `pnpm db:generate && pnpm db:migrate`

Expected: a new migration file creating the four join tables with composite primary keys and foreign keys to `artworks`, `contacts`, `tags`, `groups`, and `collections`; `db:migrate` reports success.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- joins`

Expected: PASS (1 test).

- [ ] **Step 7: Run the full test suite**

Run: `pnpm test`

Expected: PASS — all tests from every task pass together (connection, contacts, lookups, artworks, artwork-relations, joins).

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/joins.ts src/db/schema/index.ts tests/db/joins.test.ts drizzle
git commit -m "feat: add artwork_collections, artwork_tags, contact_tags, and contact_groups tables"
```

---

## Out of Scope (matches the design doc)

- Frontend pages/routes and Tailwind styling
- The CSV import script (parsing `ContactsExport.csv` / `PiecesExport.csv` and populating these tables)
- R2 image/file upload mechanics — this plan only creates the `r2_key` columns
- Cloudflare deployment configuration
