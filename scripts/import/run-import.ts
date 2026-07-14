// scripts/import/run-import.ts
import type { Db } from '../../src/db/client'
import { parseCsvFile } from './csv-reader'
import { importArtworks } from './import-artworks'
import { importContacts } from './import-contacts'
import { parseContactsRows } from './parse-contacts'
import { parsePiecesRows } from './parse-pieces'
import type { ImportSummary } from './summary'

export interface RunImportOptions {
  db: Db
  contactsPath: string
  piecesPath: string
}

export async function runImport({
  db,
  contactsPath,
  piecesPath,
}: RunImportOptions): Promise<ImportSummary> {
  const contactRows = parseCsvFile(contactsPath)
  const {
    records: contactRecords,
    warnings: contactWarnings,
    skipped: contactSkipped,
  } = parseContactsRows(contactRows)
  const contactsImport = await importContacts(db, contactRecords)

  const pieceRows = parseCsvFile(piecesPath)
  const {
    records: pieceRecords,
    warnings: pieceWarnings,
    skipped: pieceSkipped,
  } = parsePiecesRows(pieceRows)
  const artworksImport = await importArtworks(
    db,
    pieceRecords,
    contactsImport.idMap,
  )

  return {
    contacts: contactsImport.contacts,
    contactGroups: contactsImport.contactGroups,
    contactTags: contactsImport.contactTags,
    artworks: artworksImport.artworks,
    artworkArtists: artworksImport.artworkArtists,
    artworkImages: artworksImport.artworkImages,
    artworkFiles: artworksImport.artworkFiles,
    artworkCollections: artworksImport.artworkCollections,
    artworkTags: artworksImport.artworkTags,
    warningMessages: [
      ...contactWarnings.map(
        (issue) => `contacts row ${issue.row}: ${issue.reason}`,
      ),
      ...pieceWarnings.map(
        (issue) => `pieces row ${issue.row}: ${issue.reason}`,
      ),
      ...artworksImport.warningMessages,
    ],
    skippedMessages: [
      ...contactSkipped.map(
        (issue) => `contacts row ${issue.row}: ${issue.reason}`,
      ),
      ...pieceSkipped.map(
        (issue) => `pieces row ${issue.row}: ${issue.reason}`,
      ),
    ],
  }
}
