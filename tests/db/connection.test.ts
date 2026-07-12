// tests/db/connection.test.ts
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';

describe('database connection', () => {
  it('connects to the test database', async () => {
    const result = await testDb.execute(sql`select 1 as value`);

    expect(Number(result.rows[0].value)).toBe(1);
  });
});
