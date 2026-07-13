// tests/import/summary.test.ts
import { describe, expect, it, vi } from 'vitest';
import { printSummary } from '../../scripts/import/summary';
import type { ImportSummary } from '../../scripts/import/summary';

function emptyResult() {
  return { processed: 0, skipped: 0, warnings: 0 };
}

describe('printSummary', () => {
  it('prints a table of results plus warning and skip messages', () => {
    const summary: ImportSummary = {
      contacts: { processed: 2, skipped: 0, warnings: 0 },
      contactGroups: emptyResult(),
      contactTags: emptyResult(),
      artworks: { processed: 1, skipped: 0, warnings: 1 },
      artworkArtists: emptyResult(),
      artworkImages: emptyResult(),
      artworkFiles: emptyResult(),
      artworkCollections: emptyResult(),
      artworkTags: emptyResult(),
      warningMessages: ['pieces row 5: seller contact id 999 not found'],
      skippedMessages: ['contacts row 9: missing/invalid Contact Id ""'],
    };

    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printSummary(summary);

    expect(tableSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 warning(s)'));
    expect(logSpy).toHaveBeenCalledWith('  [WARN] pieces row 5: seller contact id 999 not found');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 skipped row(s)'));
    expect(logSpy).toHaveBeenCalledWith('  [SKIP] contacts row 9: missing/invalid Contact Id ""');

    tableSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('omits the warning/skip sections when there are none', () => {
    const summary: ImportSummary = {
      contacts: emptyResult(),
      contactGroups: emptyResult(),
      contactTags: emptyResult(),
      artworks: emptyResult(),
      artworkArtists: emptyResult(),
      artworkImages: emptyResult(),
      artworkFiles: emptyResult(),
      artworkCollections: emptyResult(),
      artworkTags: emptyResult(),
      warningMessages: [],
      skippedMessages: [],
    };

    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printSummary(summary);

    expect(logSpy).not.toHaveBeenCalled();

    tableSpy.mockRestore();
    logSpy.mockRestore();
  });
});
