// tests/db/artwork-relations.test.ts
import { describe, expect, it } from 'vitest';
import { eq, type InferSelectModel } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { artworkArtists, artworkFiles, artworkImages, artworks, contacts } from '../../src/db/schema';

describe('artwork relation tables', () => {
  it('links an artwork to an artist, an image, and a file', async () => {
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);
    // Declared outside the try block (unlike the other tests' locals) because the
    // finally block below needs to reference it for cleanup; a `const` declared
    // inside `try` is out of scope in `finally` in JavaScript.
    let artwork: InferSelectModel<typeof artworks> | undefined;

    try {
      const [artist] = await testDb
        .insert(contacts)
        .values({ sourceContactId, firstName: 'Ada', lastName: 'Lovelace', isArtist: true })
        .returning();

      [artwork] = await testDb
        .insert(artworks)
        .values({ sourcePieceId, title: 'Collaborative Piece' })
        .returning();

      await testDb.insert(artworkArtists).values({
        artworkId: artwork.id,
        contactId: artist.id,
        role: 'primary',
        sortOrder: 0,
      });

      const [image] = await testDb
        .insert(artworkImages)
        .values({
          artworkId: artwork.id,
          r2Key: 'artworks/test/primary.jpg',
          isPrimary: true,
          sortOrder: 0,
        })
        .returning();

      const [file] = await testDb
        .insert(artworkFiles)
        .values({
          artworkId: artwork.id,
          name: 'Certificate of Authenticity',
          r2Key: 'artworks/test/coa.pdf',
          sortOrder: 0,
        })
        .returning();

      const linkedArtists = await testDb
        .select()
        .from(artworkArtists)
        .where(eq(artworkArtists.artworkId, artwork.id));

      expect(linkedArtists).toHaveLength(1);
      expect(linkedArtists[0].role).toBe('primary');
      expect(image.isPrimary).toBe(true);
      expect(file.name).toBe('Certificate of Authenticity');
    } finally {
      await testDb.delete(artworkFiles).where(eq(artworkFiles.artworkId, artwork!.id));
      await testDb.delete(artworkImages).where(eq(artworkImages.artworkId, artwork!.id));
      await testDb.delete(artworkArtists).where(eq(artworkArtists.artworkId, artwork!.id));
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
    }
  });

  it('rejects an artwork_artists role outside primary/additional', async () => {
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);

    try {
      const [artist] = await testDb
        .insert(contacts)
        .values({ sourceContactId, firstName: 'Ada', lastName: 'Lovelace', isArtist: true })
        .returning();

      const [artwork] = await testDb
        .insert(artworks)
        .values({ sourcePieceId, title: 'Collaborative Piece' })
        .returning();

      await expect(
        testDb.insert(artworkArtists).values({
          artworkId: artwork.id,
          contactId: artist.id,
          // @ts-expect-error intentionally invalid role to test the DB enum constraint
          role: 'co-artist',
        }),
      ).rejects.toThrow();
    } finally {
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
    }
  });
});
