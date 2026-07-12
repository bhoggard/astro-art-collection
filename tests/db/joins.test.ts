// tests/db/joins.test.ts
import { describe, expect, it } from 'vitest';
import { eq, type InferSelectModel } from 'drizzle-orm';
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
    // Declared outside the try block because the finally block below needs to
    // reference them for cleanup; a `const` declared inside `try` is out of
    // scope in `finally` in JavaScript.
    let artist: InferSelectModel<typeof contacts> | undefined;
    let artwork: InferSelectModel<typeof artworks> | undefined;

    try {
      [artist] = await testDb
        .insert(contacts)
        .values({ sourceContactId, firstName: 'Ada', lastName: 'Lovelace', isArtist: true })
        .returning();

      [artwork] = await testDb
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
