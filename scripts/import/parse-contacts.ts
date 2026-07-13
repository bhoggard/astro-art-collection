// scripts/import/parse-contacts.ts
import { cleanText, parseBirthDate, parseDateOrNull, parseDelimited, parseLiteralBoolean } from './normalize';

export interface RowIssue {
  row: number;
  reason: string;
}

export interface ContactRecord {
  rowNumber: number;
  sourceContactId: number;
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  secondaryEmail: string | null;
  jobTitle: string | null;
  companyName: string | null;
  workPhone: string | null;
  phone: string | null;
  mobilePhone: string | null;
  website: string | null;
  birthDate: string | null;
  deathDate: string | null;
  nationality: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  secondaryAddress1: string | null;
  secondaryAddress2: string | null;
  secondaryCity: string | null;
  secondaryState: string | null;
  secondaryZip: string | null;
  secondaryCountry: string | null;
  isArtist: boolean;
  bio: string | null;
  notes: string | null;
  location: string | null;
  sourceLocationId: number | null;
  instagramUrl: string | null;
  dateAdded: string | null;
  groups: string[];
  tags: string[];
}

export interface ParseContactsResult {
  records: ContactRecord[];
  warnings: RowIssue[];
  skipped: RowIssue[];
}

export function parseContactsRows(rows: string[][]): ParseContactsResult {
  const records: ContactRecord[] = [];
  const warnings: RowIssue[] = [];
  const skipped: RowIssue[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;
    const sourceContactIdRaw = row[0]?.trim() ?? '';
    const sourceContactId = Number(sourceContactIdRaw);

    if (sourceContactIdRaw === '' || !Number.isFinite(sourceContactId)) {
      skipped.push({ row: rowNumber, reason: `missing/invalid Contact Id "${sourceContactIdRaw}"` });
      continue;
    }

    const birthDate = parseBirthDate(row[14]);
    if (birthDate.warning) warnings.push({ row: rowNumber, reason: birthDate.warning.reason });

    const deathDate = parseDateOrNull(row[15], 'Death Date');
    if (deathDate.warning) warnings.push({ row: rowNumber, reason: deathDate.warning.reason });

    const dateAdded = parseDateOrNull(row[row.length - 1], 'Date Added');
    if (dateAdded.warning) warnings.push({ row: rowNumber, reason: dateAdded.warning.reason });

    const sourceLocationIdRaw = row[37]?.trim() ?? '';
    const sourceLocationId = sourceLocationIdRaw !== '' && Number.isFinite(Number(sourceLocationIdRaw))
      ? Number(sourceLocationIdRaw)
      : null;

    records.push({
      rowNumber,
      sourceContactId,
      title: cleanText(row[1]),
      firstName: cleanText(row[2]),
      lastName: cleanText(row[3]),
      email: cleanText(row[4]),
      secondaryEmail: cleanText(row[5]),
      jobTitle: cleanText(row[6]),
      companyName: cleanText(row[7]),
      workPhone: cleanText(row[8]),
      phone: cleanText(row[9]),
      mobilePhone: cleanText(row[10]),
      website: cleanText(row[11]),
      birthDate: birthDate.value,
      deathDate: deathDate.value,
      nationality: cleanText(row[16]),
      address1: cleanText(row[17]),
      address2: cleanText(row[18]),
      city: cleanText(row[19]),
      state: cleanText(row[20]),
      zip: cleanText(row[21]),
      country: cleanText(row[22]),
      secondaryAddress1: cleanText(row[23]),
      secondaryAddress2: cleanText(row[24]),
      secondaryCity: cleanText(row[25]),
      secondaryState: cleanText(row[26]),
      secondaryZip: cleanText(row[27]),
      secondaryCountry: cleanText(row[28]),
      isArtist: parseLiteralBoolean(row[30]),
      bio: cleanText(row[34]),
      notes: cleanText(row[35]),
      location: cleanText(row[36]),
      sourceLocationId,
      instagramUrl: cleanText(row[39]),
      dateAdded: dateAdded.value,
      groups: parseDelimited(row[32]),
      tags: parseDelimited(row[33]),
    });
  }

  return { records, warnings, skipped };
}
