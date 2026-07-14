// tests/helpers/test-db.ts
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from '../../src/db/schema'

const connectionString = process.env.ART_COLLECTION_TEST_DB

if (!connectionString) {
  throw new Error('ART_COLLECTION_TEST_DB environment variable is not set')
}

const sql = neon(connectionString)

export const testDb = drizzle(sql, { schema })
