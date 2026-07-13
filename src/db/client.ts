// src/db/client.ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const connectionString = process.env.ART_COLLECTION_POSTGRES;

if (!connectionString) {
  throw new Error('ART_COLLECTION_POSTGRES environment variable is not set');
}

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });

export type Db = NeonHttpDatabase<typeof schema>;
