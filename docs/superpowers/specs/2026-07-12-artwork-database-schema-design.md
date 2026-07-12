# Artwork Database Schema Design

Date: 2026-07-12
Status: Approved (pending user review)

## Purpose

Design the Postgres schema (via Drizzle) that will hold the Hoggard Wagner art
collection data currently exported from Artwork Archive as
`ContactsExport.csv` and `PiecesExport.csv` (see `~/art-collection-data`).
This is the first design phase called for by `docs/SPEC.md`: schema only.
Frontend pages, Tailwind styling, the import script's implementation, R2
image upload, and Cloudflare deployment are out of scope here and will be
designed/planned in later phases.

## Scope decisions

- **Store everything relevant to collection management**, not just
  public-website fields — including purchase, donation, loan-in, valuation,
  and provenance data. Sensitive fields are simply not queried by the public
  site later; they aren't excluded from the database.
- **No sale/pricing data.** The collection does not sell work, so `price`,
  `wholesale_price`, and all `sale_*` / `sold_to` fields from the CSV are
  dropped entirely. Purchase (acquisition) and donation fields are kept —
  those describe how a piece entered the collection, not a sale.
- **No appraiser tracking.** `is_appraiser` on contacts and
  `last_appraisal_date` / `last_appraisal_value` / `last_appraiser` on
  artworks are dropped.
- **Provenance is a public field** (per explicit instruction), unlike most of
  the acquisition/valuation data.
- **Location is current-state only.** No location history table — the CSV's
  current-location fields are copied onto the artwork row directly. Loan-in
  dates/value are kept since that's collection-relevant, distinct from
  location history.
- Only Instagram is kept from the contact social-media URLs.
- Spouse fields are dropped from contacts.
- `Additional Files` (pipe-delimited in the CSV) becomes a proper one-to-many
  table, not a JSONB blob.

## Tables

### `contacts`

One table for every person/entity in the CSV (artists, galleries, buyers,
donors), matching the source data's own `Artist` boolean rather than
splitting into separate tables — this avoids duplicating a person who plays
more than one role (e.g. an artist who is also a donor).

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `source_contact_id` | int, unique | Artwork Archive `Contact Id`; used for idempotent upsert on re-import |
| `title` | text | |
| `first_name` | text | |
| `last_name` | text | |
| `email` | text | |
| `secondary_email` | text | |
| `job_title` | text | |
| `company_name` | text | |
| `work_phone` | text | |
| `phone` | text | |
| `mobile_phone` | text | |
| `website` | text | |
| `birth_date` | date, nullable | |
| `death_date` | date, nullable | |
| `nationality` | text | |
| `address1` / `address2` / `city` / `state` / `zip` / `country` | text | |
| `secondary_address1` / `secondary_address2` / `secondary_city` / `secondary_state` / `secondary_zip` / `secondary_country` | text | |
| `is_artist` | boolean | from CSV `Artist` column |
| `bio` | text | |
| `notes` | text | |
| `location` | text | |
| `source_location_id` | int, nullable | Artwork Archive location id |
| `instagram_url` | text | |
| `date_added` | date | |

Dropped from source CSV: `Spouse First`, `Spouse Last`, `Appraiser`,
`Facebook URL`, `Twitter URL`, `LinkedIn URL`, `Pinterest URL`,
`Artist Piece Count` (derivable via query, not stored).

Tags and groups are modeled as lookup + join tables, not raw text — see
below.

### `artworks`

One row per piece (source CSV calls these "Pieces").

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `source_piece_id` | int, unique | Artwork Archive `Piece Id`; idempotent upsert key |
| `title` | text | CSV `Name` |
| `inventory_number` | text | |
| `type` | text | Observed values: Work on Paper, Sculpture, Photography, Print, Collage, Painting, Other, Film/Video, Textile. Kept as free text (not a Postgres enum) since Artwork Archive's picklist could add values that would otherwise break re-import. |
| `medium` | text | |
| `subject_matter` | text | |
| `height` / `width` / `depth` | numeric, nullable | |
| `dimension_override` | text | free-form dimension string when structured fields don't apply |
| `weight` | numeric, nullable | |
| `framed` | boolean | normalized from CSV's inconsistent `"yes"` / `"true"` / empty |
| `framed_height` / `framed_width` / `framed_depth` | numeric, nullable | |
| `paper_height` / `paper_width` | numeric, nullable | |
| `creation_year` | int, nullable | |
| `creation_date_circa` | boolean | |
| `creation_date_override` | text | |
| `description` | text | |
| `notes` | text | |
| `signed` | boolean | |
| `signature_notes` | text | |
| `condition` | text | |
| `condition_notes` | text | |
| `edition` | text | |
| `edition_info` | text | |
| `attribution` | text | |
| `is_public` | boolean | from CSV `Public` column; drives what the public site displays |
| `purchase_date` | date, nullable | |
| `purchase_price` | numeric, nullable | |
| `purchase_currency` | text | |
| `source_purchase_location_id` | int, nullable | |
| `purchase_location_name` | text | |
| `seller_contact_id` | FK → `contacts.id`, nullable | resolved by matching source contact id; unresolvable names are logged as import warnings |
| `purchase_url` | text | |
| `donation_date` | date, nullable | |
| `donor_contact_id` | FK → `contacts.id`, nullable | |
| `donation_value` | numeric, nullable | |
| `loan_in_start_date` / `loan_in_end_date` | date, nullable | |
| `loan_in_value` | numeric, nullable | |
| `loan_in_contact_id` | FK → `contacts.id`, nullable | |
| `fair_market_value` | numeric, nullable | |
| `insurance_value` | numeric, nullable | |
| `provenance_notes` | text | **public field** |
| `source` | text | |
| `current_location_name` | text | |
| `source_current_location_id` | int, nullable | |
| `current_sub_location_name` | text | |
| `current_tertiary_location_name` | text | |
| `current_location_start_date` / `current_location_end_date` | date, nullable | |
| `current_location_notes` | text | |
| `current_location_latitude` / `current_location_longitude` | numeric, nullable | |
| `last_updated` | timestamp | |
| `last_updated_by` | text | |
| `date_added` | date | |

Dropped from source CSV: `Price`, `Wholesale Price`, `Sale Id`, `Sale Type`,
`Sale Date`, `Sale Price`, `Sale Net`, `Sale Location`, `Sold To`,
`Last Appraisal Date`, `Last Appraisal Value`, `Last Appraiser`.

### `artwork_files`

Replaces the CSV's pipe-delimited `Additional Files (name | notes | url)`
column with a proper one-to-many table.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `artwork_id` | FK → `artworks.id` | |
| `name` | text | |
| `notes` | text | |
| `url` | text | |
| `sort_order` | int | |

### `artwork_images`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `artwork_id` | FK → `artworks.id` | |
| `r2_key` | text | destination key once the image is uploaded to R2 (upload itself is a later phase) |
| `caption` | text | |
| `sort_order` | int | |
| `is_primary` | boolean | |

Populated from `Primary Image Url` plus the 30 `Additional Image N URL` /
`Additional Image N Caption` column pairs.

### `artwork_artists`

Many-to-many join, since pieces can have collaborating artists
(`Additional Artist(s)` / `Artist Id(s)` in the CSV).

| Column | Type | Notes |
|---|---|---|
| `artwork_id` | FK → `artworks.id` | |
| `contact_id` | FK → `contacts.id` | |
| `role` | enum: `primary`, `additional` | |
| `sort_order` | int | |

Primary key: (`artwork_id`, `contact_id`).

### `collections` / `artwork_collections`

`collections`: `id`, `name` (unique).
`artwork_collections`: `artwork_id` (FK), `collection_id` (FK) — PK on both.

### `tags` / `artwork_tags` / `contact_tags`

`tags`: `id`, `name` (unique) — shared between artworks and contacts.
`artwork_tags`: `artwork_id` (FK), `tag_id` (FK) — PK on both.
`contact_tags`: `contact_id` (FK), `tag_id` (FK) — PK on both.

### `groups` / `contact_groups`

`groups`: `id`, `name` (unique) — contacts-only, from CSV `Groups` column.
`contact_groups`: `contact_id` (FK), `group_id` (FK) — PK on both.

## Import process (design-level; implementation is a later phase)

- **Parser:** a real CSV parser (e.g. `csv-parse`), not manual line-splitting
  — required because the export's unquoted-header/value quirks would
  misalign columns under naive splitting.
- **Idempotency:** upsert by `source_contact_id` / `source_piece_id`, since
  both CSVs are re-exported periodically and the script must be safely
  re-runnable.
- **Import order** (FK dependencies):
  1. `contacts`
  2. `collections`, `tags`, `groups`
  3. `artworks` (needs contacts for seller/donor/loan-in FKs)
  4. `artwork_artists`, `artwork_images`, `artwork_files`,
     `artwork_collections`, `artwork_tags`, `contact_tags`, `contact_groups`
- **Error handling:** row-level failures (missing required field,
  unresolvable contact reference, malformed date/number) are logged with row
  number and reason, then skipped — never fatal to the whole run. The script
  prints an end-of-run summary (processed / skipped / warnings).
- **Boolean normalization:** any non-empty value in a yes/no-style CSV column
  (`framed`, `signed`, `date_is_circa`, `public`) is treated as `true`; empty
  is `false`.
- **Testing:** a small fixture CSV (hand-picked rows covering a multi-artist
  piece, a piece with several images, and rows with missing optional fields)
  drives an integration test of the import script against a local/test
  Postgres instance, asserting row counts and spot-checked field values.

## Out of scope for this design

- Frontend pages/routes and Tailwind styling
- The import script's actual implementation
- R2 image upload mechanics (this schema only stores the eventual `r2_key`)
- Cloudflare deployment configuration
- Location history / audit trail (current-location-only was chosen)
