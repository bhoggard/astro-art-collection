// src/db/schema/joins.ts
import { integer, pgTable, primaryKey } from 'drizzle-orm/pg-core'
import { artworks } from './artworks'
import { contacts } from './contacts'
import { collections, groups, tags } from './lookups'

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
)

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
)

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
)

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
)
