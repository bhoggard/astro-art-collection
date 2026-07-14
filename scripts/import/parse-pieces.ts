// scripts/import/parse-pieces.ts
import {
  cleanText,
  parseBoolean,
  parseCreationYear,
  parseDateOrNull,
  parseDelimited,
  parseNumericOrNull,
  parseTimestampOrNull,
} from './normalize'
import type { RowIssue } from './parse-contacts'

export type { RowIssue }

export interface ArtworkImageRecord {
  url: string
  caption: string | null
  sortOrder: number
  isPrimary: boolean
}

export interface ArtworkFileRecord {
  name: string | null
  notes: string | null
  url: string
  sortOrder: number
}

export interface ArtworkRecord {
  rowNumber: number
  sourcePieceId: number
  title: string | null
  inventoryNumber: string | null
  type: string | null
  medium: string | null
  subjectMatter: string | null
  height: string | null
  width: string | null
  depth: string | null
  dimensionOverride: string | null
  weight: string | null
  framed: boolean
  framedHeight: string | null
  framedWidth: string | null
  framedDepth: string | null
  paperHeight: string | null
  paperWidth: string | null
  creationYear: number | null
  creationDateCirca: boolean
  creationDateOverride: string | null
  description: string | null
  notes: string | null
  signed: boolean
  signatureNotes: string | null
  currentLocationName: string | null
  sourceCurrentLocationId: number | null
  currentSubLocationName: string | null
  currentTertiaryLocationName: string | null
  currentLocationStartDate: string | null
  currentLocationEndDate: string | null
  currentLocationNotes: string | null
  currentLocationLatitude: string | null
  currentLocationLongitude: string | null
  provenanceNotes: string | null
  condition: string | null
  conditionNotes: string | null
  edition: string | null
  editionInfo: string | null
  purchaseDate: string | null
  purchasePrice: string | null
  purchaseCurrency: string | null
  sourcePurchaseLocationId: number | null
  purchaseLocationName: string | null
  sellerSourceContactId: number | null
  attribution: string | null
  fairMarketValue: string | null
  insuranceValue: string | null
  source: string | null
  purchaseUrl: string | null
  lastUpdated: Date | null
  lastUpdatedBy: string | null
  isPublic: boolean
  dateAdded: string | null
  artistSourceIds: number[]
  collections: string[]
  tags: string[]
  images: ArtworkImageRecord[]
  files: ArtworkFileRecord[]
}

export interface ParsePiecesResult {
  records: ArtworkRecord[]
  warnings: RowIssue[]
  skipped: RowIssue[]
}

function parseIntOrNull(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '' || !Number.isFinite(Number(trimmed))) return null
  return Number(trimmed)
}

function parseImages(row: string[]): ArtworkImageRecord[] {
  const images: ArtworkImageRecord[] = []
  const primaryUrl = cleanText(row[76])
  if (primaryUrl) {
    images.push({
      url: primaryUrl,
      caption: cleanText(row[77]),
      sortOrder: 0,
      isPrimary: true,
    })
  }
  for (let n = 1; n <= 30; n++) {
    const urlIndex = 78 + (n - 1) * 2
    const captionIndex = urlIndex + 1
    const url = cleanText(row[urlIndex])
    if (!url) continue
    images.push({
      url,
      caption: cleanText(row[captionIndex]),
      sortOrder: images.length,
      isPrimary: false,
    })
  }
  return images
}

function parseFiles(row: string[]): ArtworkFileRecord[] {
  const tail = row.slice(142)
  if (tail.length <= 1) return []
  const usableLength = tail.length - (tail.length % 3)
  const files: ArtworkFileRecord[] = []
  for (let offset = 0; offset < usableLength; offset += 3) {
    const name = cleanText(tail[offset])
    const notes = cleanText(tail[offset + 1])
    const url = cleanText(tail[offset + 2])
    if (!name && !notes && !url) continue
    if (!url) continue
    files.push({ name, notes, url, sortOrder: files.length })
  }
  return files
}

export function parsePiecesRows(rows: string[][]): ParsePiecesResult {
  const records: ArtworkRecord[] = []
  const warnings: RowIssue[] = []
  const skipped: RowIssue[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 1
    const sourcePieceIdRaw = row[0]?.trim() ?? ''
    const sourcePieceId = Number(sourcePieceIdRaw)

    if (sourcePieceIdRaw === '' || !Number.isFinite(sourcePieceId)) {
      skipped.push({
        row: rowNumber,
        reason: `missing/invalid Piece Id "${sourcePieceIdRaw}"`,
      })
      continue
    }

    const height = parseNumericOrNull(row[9], 'Height')
    const width = parseNumericOrNull(row[10], 'Width')
    const depth = parseNumericOrNull(row[11], 'Depth')
    const weight = parseNumericOrNull(row[19], 'Weight')
    const framedHeight = parseNumericOrNull(row[14], 'Framed Height')
    const framedWidth = parseNumericOrNull(row[15], 'Framed Width')
    const framedDepth = parseNumericOrNull(row[16], 'Framed Depth')
    const paperHeight = parseNumericOrNull(row[17], 'Paper Height')
    const paperWidth = parseNumericOrNull(row[18], 'Paper Width')
    const purchasePrice = parseNumericOrNull(row[55], 'Purchase Price')
    const fairMarketValue = parseNumericOrNull(row[69], 'Fair Market Value')
    const insuranceValue = parseNumericOrNull(row[70], 'Insurance Value')
    const currentLocationLatitude = parseNumericOrNull(
      row[40],
      'Current Location Latitude',
    )
    const currentLocationLongitude = parseNumericOrNull(
      row[41],
      'Current Location Longitude',
    )
    const creationYear = parseCreationYear(row[23])
    const purchaseDate = parseDateOrNull(row[54], 'Purchase Date')
    const currentLocationStartDate = parseDateOrNull(
      row[37],
      'Current Location Start Date',
    )
    const currentLocationEndDate = parseDateOrNull(
      row[38],
      'Current Location End Date',
    )
    const dateAdded = parseDateOrNull(row[141], 'Date Added')
    const lastUpdated = parseTimestampOrNull(row[138], 'Last Updated')

    for (const result of [
      height,
      width,
      depth,
      weight,
      framedHeight,
      framedWidth,
      framedDepth,
      paperHeight,
      paperWidth,
      purchasePrice,
      fairMarketValue,
      insuranceValue,
      currentLocationLatitude,
      currentLocationLongitude,
      creationYear,
      purchaseDate,
      currentLocationStartDate,
      currentLocationEndDate,
      dateAdded,
      lastUpdated,
    ]) {
      if (result.warning)
        warnings.push({ row: rowNumber, reason: result.warning.reason })
    }

    const artistIds = parseDelimited(row[5])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
    const additionalArtistNames = parseDelimited(row[4])
    if (additionalArtistNames.length > Math.max(artistIds.length - 1, 0)) {
      warnings.push({
        row: rowNumber,
        reason: `${additionalArtistNames.length} additional artist name(s) but only ${Math.max(artistIds.length - 1, 0)} additional id(s)`,
      })
    }

    records.push({
      rowNumber,
      sourcePieceId,
      title: cleanText(row[1]),
      inventoryNumber: cleanText(row[6]),
      type: cleanText(row[7]),
      medium: cleanText(row[8]),
      subjectMatter: cleanText(row[20]),
      height: height.value,
      width: width.value,
      depth: depth.value,
      dimensionOverride: cleanText(row[12]),
      weight: weight.value,
      framed: parseBoolean(row[13]),
      framedHeight: framedHeight.value,
      framedWidth: framedWidth.value,
      framedDepth: framedDepth.value,
      paperHeight: paperHeight.value,
      paperWidth: paperWidth.value,
      creationYear: creationYear.value,
      creationDateCirca: parseBoolean(row[24]),
      creationDateOverride: cleanText(row[25]),
      description: cleanText(row[27]),
      notes: cleanText(row[28]),
      signed: parseBoolean(row[31]),
      signatureNotes: cleanText(row[32]),
      currentLocationName: cleanText(row[33]),
      sourceCurrentLocationId: parseIntOrNull(row[34]),
      currentSubLocationName: cleanText(row[35]),
      currentTertiaryLocationName: cleanText(row[36]),
      currentLocationStartDate: currentLocationStartDate.value,
      currentLocationEndDate: currentLocationEndDate.value,
      currentLocationNotes: cleanText(row[39]),
      currentLocationLatitude: currentLocationLatitude.value,
      currentLocationLongitude: currentLocationLongitude.value,
      provenanceNotes: cleanText(row[49]),
      condition: cleanText(row[50]),
      conditionNotes: cleanText(row[51]),
      edition: cleanText(row[52]),
      editionInfo: cleanText(row[53]),
      purchaseDate: purchaseDate.value,
      purchasePrice: purchasePrice.value,
      purchaseCurrency: cleanText(row[56]),
      sourcePurchaseLocationId: parseIntOrNull(row[57]),
      purchaseLocationName: cleanText(row[58]),
      sellerSourceContactId: parseIntOrNull(row[59]),
      attribution: cleanText(row[68]),
      fairMarketValue: fairMarketValue.value,
      insuranceValue: insuranceValue.value,
      source: cleanText(row[71]),
      purchaseUrl: cleanText(row[75]),
      lastUpdated: lastUpdated.value,
      lastUpdatedBy: cleanText(row[139]),
      isPublic: parseBoolean(row[140]),
      dateAdded: dateAdded.value,
      artistSourceIds: artistIds,
      collections: parseDelimited(row[29]),
      tags: parseDelimited(row[30]),
      images: parseImages(row),
      files: parseFiles(row),
    })
  }

  return { records, warnings, skipped }
}
