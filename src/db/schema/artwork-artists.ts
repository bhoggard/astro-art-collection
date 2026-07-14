// src/db/schema/artwork-artists.ts
import { integer, pgEnum, pgTable, primaryKey } from 'drizzle-orm/pg-core'
import { artworks } from './artworks'
import { contacts } from './contacts'

export const artworkArtistRole = pgEnum('artwork_artist_role', [
  'primary',
  'additional',
])

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
)
