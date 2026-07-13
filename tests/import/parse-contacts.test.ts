// tests/import/parse-contacts.test.ts
import { describe, expect, it } from 'vitest';
import { parseContactsRows } from '../../scripts/import/parse-contacts';

const HEADER = [
  'Contact Id', 'Title', 'First Name', 'Last Name', 'Email', 'Secondary Email', 'Job Title',
  'Company Name', 'Work Phone', 'Phone', 'Mobile Phone', 'Website', 'Spouse First', 'Spouse Last',
  'Birth Date', 'Death Date', 'Nationality', 'Address1', 'Address2', 'City', 'State', 'Zip',
  'Country', 'Secondary Address1', 'Secondary Address2', 'Secondary City', 'Secondary State',
  'Secondary Zip', 'Secondary Country', 'Appraiser', 'Artist', 'Artist Piece Count', 'Groups',
  'Tags', 'Bio', 'Notes', 'Location', 'Location Id', 'Facebook URL', 'Instagram URL',
  'Twitter URL', 'LinkedIn URL', 'Pinterest URL', 'Date Added',
];

function contactsRow(overrides: Record<number, string>): string[] {
  const row = new Array(44).fill('');
  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value;
  }
  // Every real data row has a 45th field (the phantom column at index 43 is
  // always blank; the real date-added value is the actual last field).
  row.push(row[43]);
  row[43] = '';
  return row;
}

describe('parseContactsRows', () => {
  it('maps a well-formed artist row, including the phantom-column date offset', () => {
    const row = contactsRow({
      0: '1053986',
      2: 'Melissa',
      3: 'Brown',
      14: '1974',
      16: 'American',
      30: 'true',
      32: 'Female Artists',
      39: 'https://www.instagram.com/boogiebrowntown',
      43: '2025-04-27',
    });

    const { records, warnings, skipped } = parseContactsRows([HEADER, row]);

    expect(skipped).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceContactId: 1053986,
      firstName: 'Melissa',
      lastName: 'Brown',
      birthDate: '1974-01-01',
      nationality: 'American',
      isArtist: true,
      groups: ['Female Artists'],
      instagramUrl: 'https://www.instagram.com/boogiebrowntown',
      dateAdded: '2025-04-27',
    });
    expect(warnings).toEqual([{ row: 2, reason: 'bare year "1974" approximated to January 1' }]);
  });

  it('maps a non-artist company contact with no birth date', () => {
    const row = contactsRow({
      0: '1104177',
      2: 'Zero Art Fair',
      30: 'false',
      43: '2025-07-27',
    });

    const { records, warnings } = parseContactsRows([HEADER, row]);

    expect(records[0]).toMatchObject({
      sourceContactId: 1104177,
      firstName: 'Zero Art Fair',
      isArtist: false,
      birthDate: null,
      groups: [],
      tags: [],
    });
    expect(warnings).toEqual([]);
  });

  it('skips a row with a missing Contact Id', () => {
    const row = contactsRow({ 2: 'No Id Here' });
    row[0] = '';

    const { records, skipped } = parseContactsRows([HEADER, row]);

    expect(records).toEqual([]);
    expect(skipped).toEqual([{ row: 2, reason: 'missing/invalid Contact Id ""' }]);
  });
});
