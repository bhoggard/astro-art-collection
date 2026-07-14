// tests/import/csv-fixture-helpers.ts
export const CONTACTS_HEADER = [
  'Contact Id',
  'Title',
  'First Name',
  'Last Name',
  'Email',
  'Secondary Email',
  'Job Title',
  'Company Name',
  'Work Phone',
  'Phone',
  'Mobile Phone',
  'Website',
  'Spouse First',
  'Spouse Last',
  'Birth Date',
  'Death Date',
  'Nationality',
  'Address1',
  'Address2',
  'City',
  'State',
  'Zip',
  'Country',
  'Secondary Address1',
  'Secondary Address2',
  'Secondary City',
  'Secondary State',
  'Secondary Zip',
  'Secondary Country',
  'Appraiser',
  'Artist',
  'Artist Piece Count',
  'Groups',
  'Tags',
  'Bio',
  'Notes',
  'Location',
  'Location Id',
  'Facebook URL',
  'Instagram URL',
  'Twitter URL',
  'LinkedIn URL',
  'Pinterest URL',
  'Date Added',
].join(',')

export const PIECES_HEADER = Array.from(
  { length: 143 },
  (_, i) => `Col${i}`,
).join(',')

function csvCell(value: string): string {
  return value.includes(',') || value.includes('"') || value.includes('\n')
    ? `"${value.replace(/"/g, '""')}"`
    : value
}

export interface ContactRowOptions {
  sourceContactId: number
  firstName?: string
  lastName?: string
  companyName?: string
  birthDate?: string
  nationality?: string
  isArtist?: boolean
  groups?: string
  instagramUrl?: string
  dateAdded?: string
}

export function contactsRow(options: ContactRowOptions): string {
  const cells = new Array(44).fill('')
  cells[0] = String(options.sourceContactId)
  cells[2] = options.firstName ?? ''
  cells[3] = options.lastName ?? ''
  cells[7] = options.companyName ?? ''
  cells[14] = options.birthDate ?? ''
  cells[16] = options.nationality ?? ''
  cells[29] = 'false'
  cells[30] = options.isArtist ? 'true' : 'false'
  cells[32] = options.groups ?? ''
  cells[39] = options.instagramUrl ?? ''
  // Every real data row has a 45th field: the header's "Date Added" position
  // (index 43) is always blank, and the real value lands in this extra field.
  cells.push(options.dateAdded ?? '')
  return cells.map(csvCell).join(',')
}

export interface PieceRowOptions {
  sourcePieceId: number
  title?: string
  artistSourceIds?: number[]
  type?: string
  creationDate?: string
  collections?: string
  tags?: string
  signed?: boolean
  isPublic?: boolean
  editionInfo?: string
  sellerSourceContactId?: number
  primaryImageUrl?: string
  additionalImages?: { url: string; caption?: string }[]
  files?: { name: string; notes?: string; url: string }[]
}

export function piecesRow(options: PieceRowOptions): string {
  const cells = new Array(143).fill('')
  cells[0] = String(options.sourcePieceId)
  cells[1] = options.title ?? ''
  cells[5] = (options.artistSourceIds ?? []).join(', ')
  cells[7] = options.type ?? ''
  cells[23] = options.creationDate ?? ''
  cells[29] = options.collections ?? ''
  cells[30] = options.tags ?? ''
  cells[31] = options.signed ? 'true' : ''
  cells[53] = options.editionInfo ?? ''
  cells[59] = options.sellerSourceContactId
    ? String(options.sellerSourceContactId)
    : ''
  cells[76] = options.primaryImageUrl ?? ''
  ;(options.additionalImages ?? []).forEach((image, index) => {
    const urlIndex = 78 + index * 2
    cells[urlIndex] = image.url
    cells[urlIndex + 1] = image.caption ?? ''
  })
  cells[140] = options.isPublic ? 'true' : ''
  const fileFields = (options.files ?? []).flatMap((file) => [
    file.name,
    file.notes ?? '',
    file.url,
  ])
  if (fileFields.length > 0) {
    // index 142 is the single reserved "Additional Files" slot when empty;
    // replace it with the real (name, notes, url) triples when files exist.
    cells.splice(142, 1, ...fileFields)
  }
  return cells.map(csvCell).join(',')
}
