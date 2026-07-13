// tests/import/import-artworks.test.ts
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
import { importArtworks } from '../../scripts/import/import-artworks';
import type { ArtworkRecord } from '../../scripts/import/parse-pieces';

function baseArtworkRecord(overrides: Partial<ArtworkRecord>): ArtworkRecord {
  return {
    rowNumber: 2,
    sourcePieceId: Math.floor(Math.random() * 1_000_000_000),
    title: null,
    inventoryNumber: null,
    type: null,
    medium: null,
    subjectMatter: null,
    height: null,
    width: null,
    depth: null,
    dimensionOverride: null,
    weight: null,
    framed: false,
    framedHeight: null,
    framedWidth: null,
    framedDepth: null,
    paperHeight: null,
    paperWidth: null,
    creationYear: null,
    creationDateCirca: false,
    creationDateOverride: null,
    description: null,
    notes: null,
    signed: false,
    signatureNotes: null,
    currentLocationName: null,
    sourceCurrentLocationId: null,
    currentSubLocationName: null,
    currentTertiaryLocationName: null,
    currentLocationStartDate: null,
    currentLocationEndDate: null,
    currentLocationNotes: null,
    currentLocationLatitude: null,
    currentLocationLongitude: null,
    provenanceNotes: null,
    condition: null,
    conditionNotes: null,
    edition: null,
    editionInfo: null,
    purchaseDate: null,
    purchasePrice: null,
    purchaseCurrency: null,
    sourcePurchaseLocationId: null,
    purchaseLocationName: null,
    sellerSourceContactId: null,
    attribution: null,
    fairMarketValue: null,
    insuranceValue: null,
    source: null,
    purchaseUrl: null,
    lastUpdated: null,
    lastUpdatedBy: null,
    isPublic: false,
    dateAdded: null,
    artistSourceIds: [],
    collections: [],
    tags: [],
    images: [],
    files: [],
    ...overrides,
  };
}

describe('importArtworks', () => {
  it('inserts an artwork with a resolved seller, two artists, an image, a file, a collection, and a tag', async () => {
    const primarySourceId = Math.floor(Math.random() * 1_000_000_000);
    const additionalSourceId = Math.floor(Math.random() * 1_000_000_000);
    const sellerSourceId = Math.floor(Math.random() * 1_000_000_000);
    // Randomized rather than a fixed literal: tags/collections are globally
    // unique-by-name across the whole test database, and Vitest runs test
    // files in parallel — a fixed name here would race with the same fixed
    // name used by a different test file's cleanup.
    const collectionName = `Test Collection ${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
    const tagName = `Test Tag ${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;

    const [primary] = await testDb
      .insert(contacts)
      .values({ sourceContactId: primarySourceId, firstName: 'Primary' })
      .returning();
    const [additional] = await testDb
      .insert(contacts)
      .values({ sourceContactId: additionalSourceId, firstName: 'Additional' })
      .returning();
    const [seller] = await testDb
      .insert(contacts)
      .values({ sourceContactId: sellerSourceId, companyName: 'Seller Gallery' })
      .returning();

    const contactIdMap = new Map([
      [primarySourceId, primary.id],
      [additionalSourceId, additional.id],
      [sellerSourceId, seller.id],
    ]);

    const record = baseArtworkRecord({
      title: 'Collaborative Piece',
      sellerSourceContactId: sellerSourceId,
      artistSourceIds: [primarySourceId, additionalSourceId],
      images: [{ url: 'https://example.com/image.jpg', caption: null, sortOrder: 0, isPrimary: true }],
      files: [{ name: 'Receipt', notes: null, url: 'https://example.com/receipt.pdf', sortOrder: 0 }],
      collections: [collectionName],
      tags: [tagName],
    });

    try {
      const result = await importArtworks(testDb, [record], contactIdMap);

      expect(result.artworks.processed).toBe(1);
      expect(result.artworkArtists.processed).toBe(2);
      expect(result.artworkImages.processed).toBe(1);
      expect(result.artworkFiles.processed).toBe(1);
      expect(result.artworkCollections.processed).toBe(1);
      expect(result.artworkTags.processed).toBe(1);
      expect(result.warningMessages).toEqual([]);

      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      expect(artwork.sellerContactId).toBe(seller.id);

      const artistLinks = await testDb
        .select()
        .from(artworkArtists)
        .where(eq(artworkArtists.artworkId, artwork.id));
      expect(artistLinks.find((l) => l.contactId === primary.id)?.role).toBe('primary');
      expect(artistLinks.find((l) => l.contactId === additional.id)?.role).toBe('additional');
    } finally {
      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      if (artwork) {
        await testDb.delete(artworkArtists).where(eq(artworkArtists.artworkId, artwork.id));
        await testDb.delete(artworkImages).where(eq(artworkImages.artworkId, artwork.id));
        await testDb.delete(artworkFiles).where(eq(artworkFiles.artworkId, artwork.id));
        await testDb.delete(artworkCollections).where(eq(artworkCollections.artworkId, artwork.id));
        await testDb.delete(artworkTags).where(eq(artworkTags.artworkId, artwork.id));
      }
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, primarySourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, additionalSourceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sellerSourceId));
      await testDb.delete(collections).where(eq(collections.name, collectionName));
      await testDb.delete(tags).where(eq(tags.name, tagName));
    }
  });

  it('warns and leaves sellerContactId null when the seller contact is not found', async () => {
    const record = baseArtworkRecord({ title: 'Orphan Seller Piece', sellerSourceContactId: 999_999_999 });

    try {
      const result = await importArtworks(testDb, [record], new Map());

      expect(result.warningMessages).toEqual([`row ${record.rowNumber}: seller contact id 999999999 not found`]);
      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      expect(artwork.sellerContactId).toBeNull();
    } finally {
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
    }
  });

  it('warns and drops an unresolvable artist id while keeping resolvable ones', async () => {
    const knownSourceId = Math.floor(Math.random() * 1_000_000_000);
    const [known] = await testDb
      .insert(contacts)
      .values({ sourceContactId: knownSourceId, firstName: 'Known' })
      .returning();
    const record = baseArtworkRecord({
      title: 'Partially Resolvable Piece',
      artistSourceIds: [knownSourceId, 999_999_999],
    });

    try {
      const result = await importArtworks(testDb, [record], new Map([[knownSourceId, known.id]]));

      expect(result.artworkArtists.processed).toBe(1);
      expect(result.warningMessages).toEqual([`row ${record.rowNumber}: artist id 999999999 not found in contacts`]);
      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      const links = await testDb.select().from(artworkArtists).where(eq(artworkArtists.artworkId, artwork.id));
      expect(links).toHaveLength(1);
      expect(links[0].role).toBe('primary');
    } finally {
      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      if (artwork) await testDb.delete(artworkArtists).where(eq(artworkArtists.artworkId, artwork.id));
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, knownSourceId));
    }
  });

  it('is idempotent: importing the same record twice does not duplicate rows', async () => {
    const record = baseArtworkRecord({
      title: 'Idempotent Piece',
      tags: ['Idempotent Artwork Tag'],
      images: [{ url: 'https://example.com/idempotent.jpg', caption: null, sortOrder: 0, isPrimary: true }],
    });

    try {
      await importArtworks(testDb, [record], new Map());
      await importArtworks(testDb, [record], new Map());

      const rows = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      expect(rows).toHaveLength(1);

      const imageRows = await testDb.select().from(artworkImages).where(eq(artworkImages.artworkId, rows[0].id));
      expect(imageRows).toHaveLength(1);

      const tagRows = await testDb.select().from(artworkTags).where(eq(artworkTags.artworkId, rows[0].id));
      expect(tagRows).toHaveLength(1);
    } finally {
      const [artwork] = await testDb.select().from(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      if (artwork) {
        await testDb.delete(artworkImages).where(eq(artworkImages.artworkId, artwork.id));
        await testDb.delete(artworkTags).where(eq(artworkTags.artworkId, artwork.id));
      }
      await testDb.delete(artworks).where(eq(artworks.sourcePieceId, record.sourcePieceId));
      await testDb.delete(tags).where(eq(tags.name, 'Idempotent Artwork Tag'));
    }
  });
});
