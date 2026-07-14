// scripts/import-csv.ts
import 'dotenv/config'
import os from 'node:os'
import path from 'node:path'
import { db } from '../src/db/client'
import { runImport } from './import/run-import'
import { printSummary } from './import/summary'

function argPath(flag: string, fallback: string): string {
  const prefix = `--${flag}=`
  const arg = process.argv.find((value) => value.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : fallback
}

const contactsPath = argPath(
  'contacts',
  path.join(os.homedir(), 'art-collection-data', 'ContactsExport.csv'),
)
const piecesPath = argPath(
  'pieces',
  path.join(os.homedir(), 'art-collection-data', 'PiecesExport.csv'),
)

const summary = await runImport({ db, contactsPath, piecesPath })
printSummary(summary)
