import { db } from '@/db/client';
import { productDisplayOrder } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

const ORDERABLE_CATEGORIES = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'] as const;

export async function saveDisplayOrder(
  personName: string,
  category: string,
  order: string[],
): Promise<void> {
  if (order.length === 0) {
    await db.delete(productDisplayOrder)
      .where(and(
        eq(productDisplayOrder.personName, personName),
        eq(productDisplayOrder.category, category),
      ));
    return;
  }
  await db.insert(productDisplayOrder)
    .values({ personName, category, orderIds: order, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [productDisplayOrder.personName, productDisplayOrder.category],
      set: { orderIds: order, updatedAt: new Date() },
    });
}

export async function getDisplayOrder(
  personName: string,
  category: string,
): Promise<string[]> {
  try {
    const rows = await db.select({ orderIds: productDisplayOrder.orderIds })
      .from(productDisplayOrder)
      .where(and(
        eq(productDisplayOrder.personName, personName),
        eq(productDisplayOrder.category, category),
      ));
    return rows.length > 0 ? rows[0].orderIds : [];
  } catch {
    return [];
  }
}

export async function getAllDisplayOrders(
  personName: string,
): Promise<Record<string, string[]>> {
  try {
    const rows = await db.select({ category: productDisplayOrder.category, orderIds: productDisplayOrder.orderIds })
      .from(productDisplayOrder)
      .where(eq(productDisplayOrder.personName, personName));
    const result: Record<string, string[]> = {};
    for (const r of rows) {
      if ((ORDERABLE_CATEGORIES as readonly string[]).includes(r.category) && r.orderIds.length > 0) {
        result[r.category] = r.orderIds;
      }
    }
    return result;
  } catch {
    return {};
  }
}
