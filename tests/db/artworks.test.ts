// tests/db/artworks.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { artworks, contacts } from '../../src/db/schema';

describe('artworks table', () => {
  it('inserts an artwork with a seller contact and reads it back', async () => {
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);

    try {
      const [seller] = await testDb
        .insert(contacts)
        .values({ sourceContactId, companyName: 'Test Gallery' })
        .returning();

      const [artwork] = await testDb
        .insert(artworks)
        .values({
          sourcePieceId,
          title: 'Test Piece',
          type: 'Painting',
          isPublic: true,
          sellerContactId: seller.id,
          provenanceNotes: 'Purchased directly from the artist in 2020.',
        })
        .returning();

      expect(artwork.title).toBe('Test Piece');
      expect(artwork.isPublic).toBe(true);
      expect(artwork.framed).toBe(false);
      expect(artwork.sellerContactId).toBe(seller.id);

      const [found] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.id, artwork.id));

      expect(found.provenanceNotes).toBe('Purchased directly from the artist in 2020.');
    } finally {
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
    }
  });

  it('rejects an artwork referencing a nonexistent seller contact', async () => {
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);
    const bogusContactId = 999_999_999;

    await expect(
      testDb.insert(artworks).values({
        sourcePieceId,
        title: 'Bad Reference',
        sellerContactId: bogusContactId,
      }),
    ).rejects.toThrow();
  });
});
