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
