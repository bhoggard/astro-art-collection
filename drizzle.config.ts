// drizzle.config.ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.ART_COLLECTION_POSTGRES) {
  throw new Error('ART_COLLECTION_POSTGRES environment variable is not set');
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.ART_COLLECTION_POSTGRES,
  },
});
