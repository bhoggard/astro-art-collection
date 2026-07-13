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
