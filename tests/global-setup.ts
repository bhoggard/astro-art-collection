// tests/global-setup.ts
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'

export async function setup() {
  const connectionString = process.env.ART_COLLECTION_TEST_DB

  if (!connectionString) {
    throw new Error('ART_COLLECTION_TEST_DB environment variable is not set')
  }

  const sql = neon(connectionString)
  const db = drizzle(sql)

  await migrate(db, { migrationsFolder: './drizzle' })
}
