// scripts/import/import-artworks.ts
import { eq } from 'drizzle-orm';
import type { Db } from '../../src/db/client';
import {
  artworkArtists,
  artworkCollections,
  artworkFiles,
  artworkImages,
  artworkTags,
  artworks,
} from '../../src/db/schema';
import type { TableImportResult } from './import-contacts';
import { getOrCreateCollection, getOrCreateTag } from './lookups';
import type { ArtworkRecord } from './parse-pieces';

export interface ImportArtworksResult {
  artworks: TableImportResult;
  artworkArtists: TableImportResult;
  artworkImages: TableImportResult;
  artworkFiles: TableImportResult;
  artworkCollections: TableImportResult;
  artworkTags: TableImportResult;
  warningMessages: string[];
}

function emptyResult(): TableImportResult {
  return { processed: 0, skipped: 0, warnings: 0 };
}

export async function importArtworks(
  db: Db,
  records: ArtworkRecord[],
  contactIdMap: Map<number, number>,
): Promise<ImportArtworksResult> {
  const artworksResult = emptyResult();
  const artworkArtistsResult = emptyResult();
  const artworkImagesResult = emptyResult();
  const artworkFilesResult = emptyResult();
  const artworkCollectionsResult = emptyResult();
  const artworkTagsResult = emptyResult();
  const warningMessages: string[] = [];

  for (const record of records) {
    let sellerContactId: number | null = null;
    if (record.sellerSourceContactId !== null) {
      sellerContactId = contactIdMap.get(record.sellerSourceContactId) ?? null;
      if (sellerContactId === null) {
        warningMessages.push(`row ${record.rowNumber}: seller contact id ${record.sellerSourceContactId} not found`);
        artworksResult.warnings++;
      }
    }

    const values = {
      sourcePieceId: record.sourcePieceId,
      title: record.title,
      inventoryNumber: record.inventoryNumber,
      type: record.type,
      medium: record.medium,
      subjectMatter: record.subjectMatter,
      height: record.height,
      width: record.width,
      depth: record.depth,
      dimensionOverride: record.dimensionOverride,
      weight: record.weight,
      framed: record.framed,
      framedHeight: record.framedHeight,
      framedWidth: record.framedWidth,
      framedDepth: record.framedDepth,
      paperHeight: record.paperHeight,
      paperWidth: record.paperWidth,
      creationYear: record.creationYear,
      creationDateCirca: record.creationDateCirca,
      creationDateOverride: record.creationDateOverride,
      description: record.description,
      notes: record.notes,
      signed: record.signed,
      signatureNotes: record.signatureNotes,
      condition: record.condition,
      conditionNotes: record.conditionNotes,
      edition: record.edition,
      editionInfo: record.editionInfo,
      attribution: record.attribution,
      isPublic: record.isPublic,
      purchaseDate: record.purchaseDate,
      purchasePrice: record.purchasePrice,
      purchaseCurrency: record.purchaseCurrency,
      sourcePurchaseLocationId: record.sourcePurchaseLocationId,
      purchaseLocationName: record.purchaseLocationName,
      sellerContactId,
      purchaseUrl: record.purchaseUrl,
      fairMarketValue: record.fairMarketValue,
      insuranceValue: record.insuranceValue,
      provenanceNotes: record.provenanceNotes,
      source: record.source,
      currentLocationName: record.currentLocationName,
      sourceCurrentLocationId: record.sourceCurrentLocationId,
      currentSubLocationName: record.currentSubLocationName,
      currentTertiaryLocationName: record.currentTertiaryLocationName,
      currentLocationStartDate: record.currentLocationStartDate,
      currentLocationEndDate: record.currentLocationEndDate,
      currentLocationNotes: record.currentLocationNotes,
      currentLocationLatitude: record.currentLocationLatitude,
      currentLocationLongitude: record.currentLocationLongitude,
      lastUpdated: record.lastUpdated,
      lastUpdatedBy: record.lastUpdatedBy,
      dateAdded: record.dateAdded,
    };

    const [row] = await db
      .insert(artworks)
      .values(values)
      .onConflictDoUpdate({ target: artworks.sourcePieceId, set: values })
      .returning({ id: artworks.id });

    artworksResult.processed++;

    const resolvedArtists: { contactId: number; role: 'primary' | 'additional' }[] = [];
    record.artistSourceIds.forEach((sourceId, index) => {
      const contactId = contactIdMap.get(sourceId);
      if (contactId === undefined) {
        warningMessages.push(`row ${record.rowNumber}: artist id ${sourceId} not found in contacts`);
        artworkArtistsResult.warnings++;
        return;
      }
      resolvedArtists.push({ contactId, role: index === 0 ? 'primary' : 'additional' });
    });
    await db.delete(artworkArtists).where(eq(artworkArtists.artworkId, row.id));
    if (resolvedArtists.length > 0) {
      await db.insert(artworkArtists).values(
        resolvedArtists.map((entry, sortOrder) => ({
          artworkId: row.id,
          contactId: entry.contactId,
          role: entry.role,
          sortOrder,
        })),
      );
    }
    artworkArtistsResult.processed += resolvedArtists.length;

    await db.delete(artworkImages).where(eq(artworkImages.artworkId, row.id));
    if (record.images.length > 0) {
      await db.insert(artworkImages).values(
        record.images.map((image) => ({
          artworkId: row.id,
          sourceUrl: image.url,
          r2Key: null,
          caption: image.caption,
          sortOrder: image.sortOrder,
          isPrimary: image.isPrimary,
        })),
      );
    }
    artworkImagesResult.processed += record.images.length;

    await db.delete(artworkFiles).where(eq(artworkFiles.artworkId, row.id));
    if (record.files.length > 0) {
      await db.insert(artworkFiles).values(
        record.files.map((file) => ({
          artworkId: row.id,
          name: file.name,
          notes: file.notes,
          sourceUrl: file.url,
          r2Key: null,
          sortOrder: file.sortOrder,
        })),
      );
    }
    artworkFilesResult.processed += record.files.length;

    const collectionIds = (
      await Promise.all(record.collections.map((name) => getOrCreateCollection(db, name)))
    ).filter((id): id is number => id !== null);
    await db.delete(artworkCollections).where(eq(artworkCollections.artworkId, row.id));
    if (collectionIds.length > 0) {
      await db
        .insert(artworkCollections)
        .values(collectionIds.map((collectionId) => ({ artworkId: row.id, collectionId })));
    }
    artworkCollectionsResult.processed += collectionIds.length;

    const tagIds = (await Promise.all(record.tags.map((name) => getOrCreateTag(db, name)))).filter(
      (id): id is number => id !== null,
    );
    await db.delete(artworkTags).where(eq(artworkTags.artworkId, row.id));
    if (tagIds.length > 0) {
      await db.insert(artworkTags).values(tagIds.map((tagId) => ({ artworkId: row.id, tagId })));
    }
    artworkTagsResult.processed += tagIds.length;
  }

  return {
    artworks: artworksResult,
    artworkArtists: artworkArtistsResult,
    artworkImages: artworkImagesResult,
    artworkFiles: artworkFilesResult,
    artworkCollections: artworkCollectionsResult,
    artworkTags: artworkTagsResult,
    warningMessages,
  };
}
