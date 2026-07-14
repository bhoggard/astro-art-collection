// scripts/import/import-contacts.ts
import { eq } from 'drizzle-orm'
import type { Db } from '../../src/db/client'
import { contactGroups, contactTags, contacts } from '../../src/db/schema'
import { getOrCreateGroup, getOrCreateTag } from './lookups'
import type { ContactRecord } from './parse-contacts'

export interface TableImportResult {
  processed: number
  skipped: number
  warnings: number
}

export interface ImportContactsResult {
  idMap: Map<number, number>
  contacts: TableImportResult
  contactGroups: TableImportResult
  contactTags: TableImportResult
}

function emptyResult(): TableImportResult {
  return { processed: 0, skipped: 0, warnings: 0 }
}

export async function importContacts(
  db: Db,
  records: ContactRecord[],
): Promise<ImportContactsResult> {
  const idMap = new Map<number, number>()
  const contactsResult = emptyResult()
  const contactGroupsResult = emptyResult()
  const contactTagsResult = emptyResult()

  for (const record of records) {
    const values = {
      sourceContactId: record.sourceContactId,
      title: record.title,
      firstName: record.firstName,
      lastName: record.lastName,
      email: record.email,
      secondaryEmail: record.secondaryEmail,
      jobTitle: record.jobTitle,
      companyName: record.companyName,
      workPhone: record.workPhone,
      phone: record.phone,
      mobilePhone: record.mobilePhone,
      website: record.website,
      birthDate: record.birthDate,
      deathDate: record.deathDate,
      nationality: record.nationality,
      address1: record.address1,
      address2: record.address2,
      city: record.city,
      state: record.state,
      zip: record.zip,
      country: record.country,
      secondaryAddress1: record.secondaryAddress1,
      secondaryAddress2: record.secondaryAddress2,
      secondaryCity: record.secondaryCity,
      secondaryState: record.secondaryState,
      secondaryZip: record.secondaryZip,
      secondaryCountry: record.secondaryCountry,
      isArtist: record.isArtist,
      bio: record.bio,
      notes: record.notes,
      location: record.location,
      sourceLocationId: record.sourceLocationId,
      instagramUrl: record.instagramUrl,
      dateAdded: record.dateAdded,
    }

    const [row] = await db
      .insert(contacts)
      .values(values)
      .onConflictDoUpdate({ target: contacts.sourceContactId, set: values })
      .returning({ id: contacts.id })

    idMap.set(record.sourceContactId, row.id)
    contactsResult.processed++

    const groupIds = (
      await Promise.all(record.groups.map((name) => getOrCreateGroup(db, name)))
    ).filter((id): id is number => id !== null)
    await db.delete(contactGroups).where(eq(contactGroups.contactId, row.id))
    if (groupIds.length > 0) {
      await db
        .insert(contactGroups)
        .values(groupIds.map((groupId) => ({ contactId: row.id, groupId })))
    }
    contactGroupsResult.processed += groupIds.length

    const tagIds = (
      await Promise.all(record.tags.map((name) => getOrCreateTag(db, name)))
    ).filter((id): id is number => id !== null)
    await db.delete(contactTags).where(eq(contactTags.contactId, row.id))
    if (tagIds.length > 0) {
      await db
        .insert(contactTags)
        .values(tagIds.map((tagId) => ({ contactId: row.id, tagId })))
    }
    contactTagsResult.processed += tagIds.length
  }

  return {
    idMap,
    contacts: contactsResult,
    contactGroups: contactGroupsResult,
    contactTags: contactTagsResult,
  }
}
