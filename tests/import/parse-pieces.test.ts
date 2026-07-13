// tests/import/parse-pieces.test.ts
import { describe, expect, it } from 'vitest';
import { parsePiecesRows } from '../../scripts/import/parse-pieces';

function piecesRow(overrides: Record<number, string>, extraFileFields: string[] = []): string[] {
  const row = new Array(143).fill('');
  for (const [index, value] of Object.entries(overrides)) {
    row[Number(index)] = value;
  }
  if (extraFileFields.length > 0) {
    // index 142 is the start of the (name, notes, url) triples; replace the
    // single reserved slot with the real triples.
    row.splice(142, 1, ...extraFileFields);
  }
  return row;
}

const HEADER = new Array(143).fill('');

describe('parsePiecesRows', () => {
  it('maps a well-formed single-artist row with a bare creation year', () => {
    const row = piecesRow({
      0: '4969619',
      1: '"Cash Tendered" February 1 2003 NYC',
      2: 'Nicolas',
      3: 'Dumit-Estevez',
      5: '980003',
      7: 'Work on Paper',
      9: '5.5',
      13: '',
      23: '2003',
      26: 'not_for_sale',
      55: '1.0',
      56: '$',
      140: 'true',
      141: '2024-11-13',
    });

    const { records, warnings, skipped } = parsePiecesRows([HEADER, row]);

    expect(skipped).toEqual([]);
    expect(warnings).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourcePieceId: 4969619,
      title: '"Cash Tendered" February 1 2003 NYC',
      type: 'Work on Paper',
      height: '5.5',
      creationYear: 2003,
      framed: false,
      isPublic: true,
      purchasePrice: '1.0',
      purchaseCurrency: '$',
      artistSourceIds: [980003],
      images: [],
      files: [],
    });
  });

  it('extracts the leading year from a year-month creation date', () => {
    const row = piecesRow({ 0: '1', 5: '1', 23: '2017-06' });

    const { records } = parsePiecesRows([HEADER, row]);

    expect(records[0].creationYear).toBe(2017);
  });

  it('parses primary and additional images, skipping the primary slot when its URL is blank', () => {
    const row = piecesRow({
      0: '1',
      5: '1',
      76: 'https://example.com/primary.jpg',
      78: 'https://example.com/additional-1.jpg',
      79: 'first additional',
    });

    const { records } = parsePiecesRows([HEADER, row]);

    expect(records[0].images).toEqual([
      { url: 'https://example.com/primary.jpg', caption: null, sortOrder: 0, isPrimary: true },
      { url: 'https://example.com/additional-1.jpg', caption: 'first additional', sortOrder: 1, isPrimary: false },
    ]);
  });

  it('chunks the Additional Files tail into name/notes/url triples', () => {
    const row = piecesRow(
      { 0: '1', 5: '1' },
      ['Zero Art Fair contract', '', 'https://example.com/contract.pdf'],
    );

    const { records } = parsePiecesRows([HEADER, row]);

    expect(records[0].files).toEqual([
      { name: 'Zero Art Fair contract', notes: null, url: 'https://example.com/contract.pdf', sortOrder: 0 },
    ]);
  });

  it('chunks multiple Additional Files triples in one row', () => {
    const row = piecesRow(
      { 0: '1', 5: '1' },
      [
        'Front', '', 'https://example.com/front.jpg',
        'Back', '', 'https://example.com/back.jpg',
      ],
    );

    const { records } = parsePiecesRows([HEADER, row]);

    expect(records[0].files).toEqual([
      { name: 'Front', notes: null, url: 'https://example.com/front.jpg', sortOrder: 0 },
      { name: 'Back', notes: null, url: 'https://example.com/back.jpg', sortOrder: 1 },
    ]);
  });

  it('parses a comma-delimited Artist Id(s) list as primary + additional artists', () => {
    const row = piecesRow({ 0: '1', 5: '100, 200' });

    const { records } = parsePiecesRows([HEADER, row]);

    expect(records[0].artistSourceIds).toEqual([100, 200]);
  });

  it('does not warn about additional artist names when a piece has no artist ids and no additional names', () => {
    const row = piecesRow({ 0: '1' });

    const { warnings } = parsePiecesRows([HEADER, row]);

    expect(warnings).toEqual([]);
  });

  it('skips a row with a missing Piece Id', () => {
    const row = piecesRow({ 5: '1' });
    row[0] = '';

    const { records, skipped } = parsePiecesRows([HEADER, row]);

    expect(records).toEqual([]);
    expect(skipped).toEqual([{ row: 2, reason: 'missing/invalid Piece Id ""' }]);
  });
});
