// scripts/import/lookups.ts
import type { Db } from '../../src/db/client';
import { collections, groups, tags } from '../../src/db/schema';
import { cleanText } from './normalize';

export async function getOrCreateTag(db: Db, rawName: string): Promise<number | null> {
  const name = cleanText(rawName);
  if (!name) return null;
  const [row] = await db
    .insert(tags)
    .values({ name })
    .onConflictDoUpdate({ target: tags.name, set: { name } })
    .returning({ id: tags.id });
  return row.id;
}

export async function getOrCreateGroup(db: Db, rawName: string): Promise<number | null> {
  const name = cleanText(rawName);
  if (!name) return null;
  const [row] = await db
    .insert(groups)
    .values({ name })
    .onConflictDoUpdate({ target: groups.name, set: { name } })
    .returning({ id: groups.id });
  return row.id;
}

export async function getOrCreateCollection(db: Db, rawName: string): Promise<number | null> {
  const name = cleanText(rawName);
  if (!name) return null;
  const [row] = await db
    .insert(collections)
    .values({ name })
    .onConflictDoUpdate({ target: collections.name, set: { name } })
    .returning({ id: collections.id });
  return row.id;
}
