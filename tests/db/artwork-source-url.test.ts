// tests/db/artwork-source-url.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { artworkFiles, artworkImages, artworks } from '../../src/db/schema';

describe('artwork_images/artwork_files sourceUrl column', () => {
  it('stores sourceUrl with r2Key left null', async () => {
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000);

    try {
      const [artwork] = await testDb
        .insert(artworks)
        .values({ sourcePieceId, title: 'Source URL Test Piece' })
        .returning();

      const [image] = await testDb
        .insert(artworkImages)
        .values({
          artworkId: artwork.id,
          sourceUrl: 'https://assets.artworkarchive.com/image/upload/example.jpg',
          isPrimary: true,
          sortOrder: 0,
        })
        .returning();

      const [file] = await testDb
        .insert(artworkFiles)
        .values({
          artworkId: artwork.id,
          name: 'Certificate',
          sourceUrl: 'https://assets.artworkarchive.com/image/upload/example.pdf',
          sortOrder: 0,
        })
        .returning();

      expect(image.sourceUrl).toBe('https://assets.artworkarchive.com/image/upload/example.jpg');
      expect(image.r2Key).toBeNull();
      expect(file.sourceUrl).toBe('https://assets.artworkarchive.com/image/upload/example.pdf');
      expect(file.r2Key).toBeNull();
    } finally {
      await testDb.delete(artworkImages).where(eq(artworkImages.artworkId, (await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, sourcePieceId)))[0]?.id ?? -1));
      await testDb.delete(artworkFiles).where(eq(artworkFiles.artworkId, (await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, sourcePieceId)))[0]?.id ?? -1));
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
    }
  });
});
