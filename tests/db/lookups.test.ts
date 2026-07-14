// tests/db/lookups.test.ts
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDb } from '../helpers/test-db'
import { collections, groups, tags } from '../../src/db/schema'

describe('lookup tables', () => {
  it('inserts and reads back a tag, a group, and a collection', async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`
    const tagName = `test-tag-${suffix}`
    const groupName = `test-group-${suffix}`
    const collectionName = `test-collection-${suffix}`

    try {
      const [tag] = await testDb
        .insert(tags)
        .values({ name: tagName })
        .returning()
      const [group] = await testDb
        .insert(groups)
        .values({ name: groupName })
        .returning()
      const [collection] = await testDb
        .insert(collections)
        .values({ name: collectionName })
        .returning()

      expect(tag.name).toBe(tagName)
      expect(group.name).toBe(groupName)
      expect(collection.name).toBe(collectionName)
    } finally {
      await testDb.delete(tags).where(eq(tags.name, tagName))
      await testDb.delete(groups).where(eq(groups.name, groupName))
      await testDb
        .delete(collections)
        .where(eq(collections.name, collectionName))
    }
  })

  it('rejects a duplicate tag name', async () => {
    const tagName = `dup-tag-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`

    try {
      await testDb.insert(tags).values({ name: tagName })

      await expect(
        testDb.insert(tags).values({ name: tagName }),
      ).rejects.toThrow()
    } finally {
      await testDb.delete(tags).where(eq(tags.name, tagName))
    }
  })
})
