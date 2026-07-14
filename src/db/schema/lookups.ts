import { pgTable, serial, text } from 'drizzle-orm/pg-core'

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
})

export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
})

export const collections = pgTable('collections', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
})
