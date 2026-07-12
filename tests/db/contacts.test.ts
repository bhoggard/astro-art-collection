// tests/db/contacts.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { contacts } from '../../src/db/schema';

describe('contacts table', () => {
  it('inserts and reads back a contact', async () => {
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);

    try {
      const [inserted] = await testDb
        .insert(contacts)
        .values({
          sourceContactId,
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          isArtist: true,
          instagramUrl: 'https://instagram.com/ada',
        })
        .returning();

      expect(inserted.firstName).toBe('Ada');
      expect(inserted.isArtist).toBe(true);

      const [found] = await testDb
        .select()
        .from(contacts)
        .where(eq(contacts.id, inserted.id));

      expect(found.lastName).toBe('Lovelace');
      expect(found.sourceContactId).toBe(sourceContactId);
    } finally {
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
    }
  });

  it('defaults isArtist to false when not provided', async () => {
    const sourceContactId = Math.floor(Math.random() * 1_000_000_000);

    try {
      const [inserted] = await testDb
        .insert(contacts)
        .values({ sourceContactId, companyName: 'Some Gallery' })
        .returning();

      expect(inserted.isArtist).toBe(false);
    } finally {
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, sourceContactId));
    }
  });
});
