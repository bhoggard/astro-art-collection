// tests/import/import-contacts.test.ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from '../helpers/test-db';
import { contactGroups, contactTags, contacts, groups, tags } from '../../src/db/schema';
import { importContacts } from '../../scripts/import/import-contacts';
import type { ContactRecord } from '../../scripts/import/parse-contacts';

function baseContactRecord(overrides: Partial<ContactRecord>): ContactRecord {
  return {
    rowNumber: 2,
    sourceContactId: Math.floor(Math.random() * 1_000_000_000),
    title: null,
    firstName: null,
    lastName: null,
    email: null,
    secondaryEmail: null,
    jobTitle: null,
    companyName: null,
    workPhone: null,
    phone: null,
    mobilePhone: null,
    website: null,
    birthDate: null,
    deathDate: null,
    nationality: null,
    address1: null,
    address2: null,
    city: null,
    state: null,
    zip: null,
    country: null,
    secondaryAddress1: null,
    secondaryAddress2: null,
    secondaryCity: null,
    secondaryState: null,
    secondaryZip: null,
    secondaryCountry: null,
    isArtist: false,
    bio: null,
    notes: null,
    location: null,
    sourceLocationId: null,
    instagramUrl: null,
    dateAdded: null,
    groups: [],
    tags: [],
    ...overrides,
  };
}

describe('importContacts', () => {
  it('inserts a contact and its groups/tags, mapping sourceContactId to the internal id', async () => {
    const record = baseContactRecord({
      firstName: 'Ada',
      lastName: 'Lovelace',
      isArtist: true,
      groups: ['Female Artists'],
      tags: ['Test Tag'],
    });

    try {
      const result = await importContacts(testDb, [record]);

      expect(result.contacts.processed).toBe(1);
      expect(result.idMap.get(record.sourceContactId)).toBeTypeOf('number');

      const [row] = await testDb
        .select()
        .from(contacts)
        .where(eq(contacts.sourceContactId, record.sourceContactId));
      expect(row.firstName).toBe('Ada');
      expect(row.isArtist).toBe(true);

      const groupLinks = await testDb.select().from(contactGroups).where(eq(contactGroups.contactId, row.id));
      const tagLinks = await testDb.select().from(contactTags).where(eq(contactTags.contactId, row.id));
      expect(groupLinks).toHaveLength(1);
      expect(tagLinks).toHaveLength(1);
    } finally {
      const [row] = await testDb
        .select()
        .from(contacts)
        .where(eq(contacts.sourceContactId, record.sourceContactId));
      if (row) {
        await testDb.delete(contactGroups).where(eq(contactGroups.contactId, row.id));
        await testDb.delete(contactTags).where(eq(contactTags.contactId, row.id));
      }
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, record.sourceContactId));
      await testDb.delete(groups).where(eq(groups.name, 'Female Artists'));
      await testDb.delete(tags).where(eq(tags.name, 'Test Tag'));
    }
  });

  it('is idempotent: importing the same record twice does not duplicate rows', async () => {
    const record = baseContactRecord({ firstName: 'Grace', lastName: 'Hopper', tags: ['Idempotent Tag'] });

    try {
      await importContacts(testDb, [record]);
      const result = await importContacts(testDb, [record]);

      expect(result.idMap.get(record.sourceContactId)).toBeTypeOf('number');
      const rows = await testDb
        .select()
        .from(contacts)
        .where(eq(contacts.sourceContactId, record.sourceContactId));
      expect(rows).toHaveLength(1);

      const tagLinks = await testDb.select().from(contactTags).where(eq(contactTags.contactId, rows[0].id));
      expect(tagLinks).toHaveLength(1);
    } finally {
      const [row] = await testDb
        .select()
        .from(contacts)
        .where(eq(contacts.sourceContactId, record.sourceContactId));
      if (row) {
        await testDb.delete(contactTags).where(eq(contactTags.contactId, row.id));
      }
      await testDb.delete(contacts).where(eq(contacts.sourceContactId, record.sourceContactId));
      await testDb.delete(tags).where(eq(tags.name, 'Idempotent Tag'));
    }
  });
});
