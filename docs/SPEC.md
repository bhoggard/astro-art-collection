# Hoggard Wagner Art Collection website

You are building a new Astro website for the Hoggard Wagner art collection. There are existing websites online at https://www.hoggardwagner.org/ and https://www.artworkarchive.com/profile/hoggard-wagner.

## Data

There are 2 CSV files exported from Artwork Archive in ~/art-collection-data. `ContactsExport.csv` contains mainly artist records. `PiecesExport.csv` contains data about artworks. Note that the export function does not format CSVs correctly. The header row has spaces without using "" to indicate that this is one column header. There may be similar errors in the data rows.

## Architecture

- Astro as site generator
- Tailwind for CSS
- Neon for the Postgres database
- Drizzle for the ORM
- Cloudflare for hosting, including R2 for images

## Environment variables

The database URL is stored in `ART_COLLECTION_POSTGRES`.

## Plan

Start by proposing a database schema for the artwork data. There will be at least artist and artwork tables.
