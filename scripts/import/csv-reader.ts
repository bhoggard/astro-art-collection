// scripts/import/csv-reader.ts
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

export function parseCsvContent(content: string): string[][] {
  return parse(content, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][];
}

export function parseCsvFile(filePath: string): string[][] {
  return parseCsvContent(readFileSync(filePath, 'utf-8'));
}
