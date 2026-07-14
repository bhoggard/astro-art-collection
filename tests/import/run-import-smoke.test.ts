// tests/import/run-import-smoke.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { testDb } from '../helpers/test-db'
import { artworkArtists, artworks, contacts } from '../../src/db/schema'
import { runImport } from '../../scripts/import/run-import'
import {
  CONTACTS_HEADER,
  PIECES_HEADER,
  contactsRow,
  piecesRow,
} from './csv-fixture-helpers'

describe('runImport (smoke)', () => {
  it('wires CSV parsing through both import stages end to end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'import-smoke-'))
    const contactsPath = join(dir, 'contacts.csv')
    const piecesPath = join(dir, 'pieces.csv')
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000)
    const sourcePieceId = Math.floor(Math.random() * 1_000_000_000)

    writeFileSync(
      contactsPath,
      `${CONTACTS_HEADER}\n${contactsRow({ sourceContactId, firstName: 'Smoke Test Artist', isArtist: true })}\n`,
    )
    writeFileSync(
      piecesPath,
      `${PIECES_HEADER}\n${piecesRow({ sourcePieceId, title: 'Smoke Test Piece', artistSourceIds: [sourceContactId] })}\n`,
    )

    try {
      const summary = await runImport({ db: testDb, contactsPath, piecesPath })

      expect(summary.contacts.processed).toBe(1)
      expect(summary.artworks.processed).toBe(1)
      expect(summary.artworkArtists.processed).toBe(1)
      expect(summary.skippedMessages).toEqual([])

      const [artwork] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, sourcePieceId))
      expect(artwork.title).toBe('Smoke Test Piece')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      const [artwork] = await testDb
        .select()
        .from(artworks)
        .where(eq(artworks.sourcePieceId, sourcePieceId))
      if (artwork) {
        await testDb
          .delete(artworkArtists)
          .where(eq(artworkArtists.artworkId, artwork.id))
      }
      await testDb
        .delete(artworks)
        .where(eq(artworks.sourcePieceId, sourcePieceId))
      await testDb
        .delete(contacts)
        .where(eq(contacts.sourceContactId, sourceContactId))
    }
  })
})
