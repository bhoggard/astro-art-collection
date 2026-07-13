// scripts/import/summary.ts
import type { TableImportResult } from './import-contacts';

export interface ImportSummary {
  contacts: TableImportResult;
  contactGroups: TableImportResult;
  contactTags: TableImportResult;
  artworks: TableImportResult;
  artworkArtists: TableImportResult;
  artworkImages: TableImportResult;
  artworkFiles: TableImportResult;
  artworkCollections: TableImportResult;
  artworkTags: TableImportResult;
  warningMessages: string[];
  skippedMessages: string[];
}

export function printSummary(summary: ImportSummary): void {
  console.table({
    contacts: summary.contacts,
    contactGroups: summary.contactGroups,
    contactTags: summary.contactTags,
    artworks: summary.artworks,
    artworkArtists: summary.artworkArtists,
    artworkImages: summary.artworkImages,
    artworkFiles: summary.artworkFiles,
    artworkCollections: summary.artworkCollections,
    artworkTags: summary.artworkTags,
  });

  if (summary.warningMessages.length > 0) {
    console.log(`\n${summary.warningMessages.length} warning(s):`);
    for (const message of summary.warningMessages) {
      console.log(`  [WARN] ${message}`);
    }
  }

  if (summary.skippedMessages.length > 0) {
    console.log(`\n${summary.skippedMessages.length} skipped row(s):`);
    for (const message of summary.skippedMessages) {
      console.log(`  [SKIP] ${message}`);
    }
  }
}
