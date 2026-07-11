// 人物単位の「重点配信確認」フラグを Neon DB で管理

import { db } from '@/db/client';
import { vodIntensivePersons } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function setPersonIntensive(personName: string, enabled: boolean): Promise<void> {
  if (enabled) {
    const now = new Date();
    await db.insert(vodIntensivePersons)
      .values({ personName, enabledAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: vodIntensivePersons.personName,
        set: { updatedAt: now },
      });
  } else {
    await db.delete(vodIntensivePersons).where(eq(vodIntensivePersons.personName, personName));
  }
}

export async function getIntensivePersonNames(): Promise<string[]> {
  try {
    const rows = await db.select({ personName: vodIntensivePersons.personName }).from(vodIntensivePersons);
    return rows.map((r) => r.personName);
  } catch {
    return [];
  }
}

export async function isPersonIntensive(personName: string): Promise<boolean> {
  try {
    const rows = await db.select({ personName: vodIntensivePersons.personName })
      .from(vodIntensivePersons)
      .where(eq(vodIntensivePersons.personName, personName));
    return rows.length > 0;
  } catch {
    return false;
  }
}
