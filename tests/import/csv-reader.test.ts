// tests/import/csv-reader.test.ts
import { describe, expect, it } from 'vitest';
import { parseCsvContent } from '../../scripts/import/csv-reader';

describe('parseCsvContent', () => {
  it('parses a simple CSV into an array of string arrays', () => {
    const content = 'Id,Name\n1,Alice\n2,Bob\n';

    const rows = parseCsvContent(content);

    expect(rows).toEqual([
      ['Id', 'Name'],
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
  });

  it('tolerates rows with more fields than the header (relax_column_count)', () => {
    const content = 'Id,Name\n1,Alice,extra,fields\n';

    const rows = parseCsvContent(content);

    expect(rows).toEqual([
      ['Id', 'Name'],
      ['1', 'Alice', 'extra', 'fields'],
    ]);
  });

  it('treats an embedded newline inside a quoted field as part of one row', () => {
    const content = 'Id,Notes\n1,"line one\nline two"\n2,"single line"\n';

    const rows = parseCsvContent(content);

    expect(rows).toEqual([
      ['Id', 'Notes'],
      ['1', 'line one\nline two'],
      ['2', 'single line'],
    ]);
  });
});
