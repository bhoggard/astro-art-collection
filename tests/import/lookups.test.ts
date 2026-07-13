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
