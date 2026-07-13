// tests/import/run-import.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import {
  artworkArtists,
  artworkCollections,
  artworkFiles,
  artworkImages,
  artworkTags,
  artworks,
  collections,
  contacts,
  tags,
} from '../../src/db/schema';
import { runImport } from '../../scripts/import/run-import';
import { CONTACTS_HEADER, PIECES_HEADER, contactsRow, piecesRow } from './csv-fixture-helpers';

async function cleanupArtwork(sourcePieceId: number): Promise<void> {
  const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
  if (!artwork) return;
  await testDb.delete(artworkArtists).where(eq(artworkArtists.artworkId, artwork.id));
  await testDb.delete(artworkImages).where(eq(artworkImages.artworkId, artwork.id));
  await testDb.delete(artworkFiles).where(eq(artworkFiles.artworkId, artwork.id));
  await testDb.delete(artworkCollections).where(eq(artworkCollections.artworkId, artwork.id));
  await testDb.delete(artworkTags).where(eq(artworkTags.artworkId, artwork.id));
  await testDb.delete(artworks).where(eq(artworks.sourcePieceId, sourcePieceId));
}

describe('runImport (end-to-end fixture)', () => {
  it('imports every scenario correctly and is safe to run twice', async () => {
    // This exercises the full pipeline twice against the real test database
    // (dozens of sequential network round-trips), which comfortably exceeds
    // vitest's default 5s per-test timeout.
    const adaSourceId = Math.floor(Math.random() * 1_000_000_000);
    const charlesSourceId = Math.floor(Math.random() * 1_000_000_000);
    const gallerySourceId = Math.floor(Math.random() * 1_000_000_000);
    const sellerSourceId = Math.floor(Math.random() * 1_000_000_000);
    const blankSourceId = Math.floor(Math.random() * 1_000_000_000);

    const multiArtistPieceId = Math.floor(Math.random() * 1_000_000_000);
    const multiImagePieceId = Math.floor(Math.random() * 1_000_000_000);
    const multiFilePieceId = Math.floor(Math.random() * 1_000_000_000);
    const blankPieceId = Math.floor(Math.random() * 1_000_000_000);
    const yearMonthPieceId = Math.floor(Math.random() * 1_000_000_000);
    const sellerPieceId = Math.floor(Math.random() * 1_000_000_000);
    const unresolvedArtistPieceId = Math.floor(Math.random() * 1_000_000_000);
    // Randomized rather than fixed literals: tags/collections are globally
    // unique-by-name across the whole test database, and Vitest runs test
    // files in parallel — fixed names here would race with the same fixed
    // names used by Task 4/5's test files.
    const collectionName = `Test Collection ${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
    const tagName = `Test Tag ${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;

    const dir = mkdtempSync(join(tmpdir(), 'import-e2e-'));
    const contactsPath = join(dir, 'contacts.csv');
    const piecesPath = join(dir, 'pieces.csv');

    const contactsCsv =
      [
        CONTACTS_HEADER,
        contactsRow({
          sourceContactId: adaSourceId,
          firstName: 'Ada',
          lastName: 'Lovelace',
          isArtist: true,
          birthDate: '1815',
          nationality: 'British',
        }),
        contactsRow({
          sourceContactId: charlesSourceId,
          firstName: 'Charles',
          lastName: 'Babbage',
          isArtist: true,
          birthDate: '1791-12-26',
          nationality: 'British',
        }),
        contactsRow({ sourceContactId: gallerySourceId, companyName: 'Test Gallery' }),
        contactsRow({ sourceContactId: sellerSourceId, companyName: 'Seller Gallery LLC' }),
        contactsRow({ sourceContactId: blankSourceId }),
      ].join('\n') + '\n';

    const piecesCsv =
      [
        PIECES_HEADER,
        piecesRow({
          sourcePieceId: multiArtistPieceId,
          title: 'Collaborative Piece',
          artistSourceIds: [adaSourceId, charlesSourceId],
        }),
        piecesRow({
          sourcePieceId: multiImagePieceId,
          title: 'Multi Image Piece',
          artistSourceIds: [adaSourceId],
          primaryImageUrl: 'https://example.com/primary.jpg',
          additionalImages: [{ url: 'https://example.com/additional-1.jpg', caption: 'side view' }],
          editionInfo: 'unnumbered of 25\nartist proof',
          collections: collectionName,
          tags: tagName,
        }),
        piecesRow({
          sourcePieceId: multiFilePieceId,
          title: 'Multi File Piece',
          artistSourceIds: [adaSourceId],
          files: [
            { name: 'Front', url: 'https://example.com/front.jpg' },
            { name: 'Back', url: 'https://example.com/back.jpg' },
          ],
        }),
        piecesRow({ sourcePieceId: blankPieceId, title: 'Blank Piece', artistSourceIds: [adaSourceId] }),
        piecesRow({
          sourcePieceId: yearMonthPieceId,
          title: 'Year Month Piece',
          artistSourceIds: [adaSourceId],
          creationDate: '2017-06',
        }),
        piecesRow({
          sourcePieceId: sellerPieceId,
          title: 'Seller Piece',
          artistSourceIds: [adaSourceId],
          sellerSourceContactId: sellerSourceId,
        }),
        piecesRow({
          sourcePieceId: unresolvedArtistPieceId,
          title: 'Unresolved Artist Piece',
          artistSourceIds: [999_999_999],
        }),
      ].join('\n') + '\n';

    writeFileSync(contactsPath, contactsCsv);
    writeFileSync(piecesPath, piecesCsv);

    try {
      const summary = await runImport({ db: testDb, contactsPath, piecesPath });

      expect(summary.contacts.processed).toBe(5);
      expect(summary.artworks.processed).toBe(7);
      expect(summary.skippedMessages).toEqual([]);

      // Multi-artist piece: two artwork_artists rows with correct roles.
      const [multiArtist] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, multiArtistPieceId));
      const artistLinks = await testDb
        .select()
        .from(artworkArtists)
        .where(eq(artworkArtists.artworkId, multiArtist.id));
      const [ada] = await testDb.select().from(contacts).where(eq(contacts.sourceContactId, adaSourceId));
      const [charles] = await testDb.select().from(contacts).where(eq(contacts.sourceContactId, charlesSourceId));
      expect(artistLinks.find((l) => l.contactId === ada.id)?.role).toBe('primary');
      expect(artistLinks.find((l) => l.contactId === charles.id)?.role).toBe('additional');
      expect(ada.birthDate).toBe('1815-01-01');
      expect(charles.birthDate).toBe('1791-12-26');

      // Multi-image piece: both images present, r2Key null, sourceUrl set, edition
      // info survived the embedded newline (collapsed to a single space by cleanText).
      const [multiImage] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, multiImagePieceId));
      const images = await testDb.select().from(artworkImages).where(eq(artworkImages.artworkId, multiImage.id));
      expect(images).toHaveLength(2);
      expect(images.find((i) => i.isPrimary)?.sourceUrl).toBe('https://example.com/primary.jpg');
      expect(images.find((i) => !i.isPrimary)?.sourceUrl).toBe('https://example.com/additional-1.jpg');
      expect(images.every((i) => i.r2Key === null)).toBe(true);
      expect(multiImage.editionInfo).toBe('unnumbered of 25 artist proof');
      const multiImageCollectionLinks = await testDb
        .select()
        .from(artworkCollections)
        .where(eq(artworkCollections.artworkId, multiImage.id));
      const multiImageTagLinks = await testDb
        .select()
        .from(artworkTags)
        .where(eq(artworkTags.artworkId, multiImage.id));
      expect(multiImageCollectionLinks).toHaveLength(1);
      expect(multiImageTagLinks).toHaveLength(1);

      // Multi-file piece: both files present, chunked correctly, r2Key null.
      const [multiFile] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, multiFilePieceId));
      const files = await testDb.select().from(artworkFiles).where(eq(artworkFiles.artworkId, multiFile.id));
      expect(files).toHaveLength(2);
      expect(files.find((f) => f.name === 'Front')?.sourceUrl).toBe('https://example.com/front.jpg');
      expect(files.find((f) => f.name === 'Back')?.sourceUrl).toBe('https://example.com/back.jpg');
      expect(files.every((f) => f.r2Key === null)).toBe(true);

      // Blank piece: zero images/files does not crash and produces zero rows.
      const [blank] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, blankPieceId));
      expect(await testDb.select().from(artworkImages).where(eq(artworkImages.artworkId, blank.id))).toHaveLength(0);
      expect(await testDb.select().from(artworkFiles).where(eq(artworkFiles.artworkId, blank.id))).toHaveLength(0);

      // Year-month creation date extracts the leading year.
      const [yearMonth] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, yearMonthPieceId));
      expect(yearMonth.creationYear).toBe(2017);

      // Seller piece resolves sellerContactId to the internal id.
      const [sellerPiece] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, sellerPieceId));
      const [seller] = await testDb.select().from(contacts).where(eq(contacts.sourceContactId, sellerSourceId));
      expect(sellerPiece.sellerContactId).toBe(seller.id);

      // Unresolved artist id: artwork still created, zero artist links, warning logged.
      const [unresolved] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, unresolvedArtistPieceId));
      const unresolvedLinks = await testDb
        .select()
        .from(artworkArtists)
        .where(eq(artworkArtists.artworkId, unresolved.id));
      expect(unresolvedLinks).toHaveLength(0);
      expect(summary.warningMessages.some((m) => m.includes('artist id 999999999 not found in contacts'))).toBe(
        true,
      );

      // --- Idempotency: re-running with identical input must not duplicate anything. ---
      await runImport({ db: testDb, contactsPath, piecesPath });

      const contactRows = await testDb.select().from(contacts).where(eq(contacts.sourceContactId, adaSourceId));
      expect(contactRows).toHaveLength(1);

      const artworkRows = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, multiArtistPieceId));
      expect(artworkRows).toHaveLength(1);

      const artistLinksAfter = await testDb
        .select()
        .from(artworkArtists)
        .where(eq(artworkArtists.artworkId, multiArtist.id));
      expect(artistLinksAfter).toHaveLength(2);

      const imagesAfter = await testDb.select().from(artworkImages).where(eq(artworkImages.artworkId, multiImage.id));
      expect(imagesAfter).toHaveLength(2);

      const filesAfter = await testDb.select().from(artworkFiles).where(eq(artworkFiles.artworkId, multiFile.id));
      expect(filesAfter).toHaveLength(2);

      const collectionLinksAfter = await testDb
        .select()
        .from(artworkCollections)
        .where(eq(artworkCollections.artworkId, multiImage.id));
      expect(collectionLinksAfter).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await cleanupArtwork(multiArtistPieceId);
      await cleanupArtwork(multiImagePieceId);
      await cleanupArtwork(multiFilePieceId);
      await cleanupArtwork(blankPieceId);
      await cleanupArtwork(yearMonthPieceId);
      await cleanupArtwork(sellerPieceId);
      await cleanupArtwork(unresolvedArtistPieceId);
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, adaSourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, charlesSourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, gallerySourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sellerSourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, blankSourceId));
      await testDb.delete(collections).where(eq(collections.name, collectionName));
      await testDb.delete(tags).where(eq(tags.name, tagName));
    }
  }, 30_000);
});
