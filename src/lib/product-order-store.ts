import { getRedis } from './redis';

const ORDERABLE_CATEGORIES = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'] as const;

function orderKey(personName: string, category: string): string {
  return `product-display-order:${personName}:${category}`;
}

export async function saveDisplayOrder(
  personName: string,
  category: string,
  order: string[],
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  if (order.length === 0) {
    await redis.del(orderKey(personName, category));
  } else {
    await redis.set(orderKey(personName, category), JSON.stringify(order));
  }
}

export async function getDisplayOrder(
  personName: string,
  category: string,
): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];
  const raw = await redis.get<string>(orderKey(personName, category));
  if (!raw) return [];
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as string[]);
}

export async function getAllDisplayOrders(
  personName: string,
): Promise<Record<string, string[]>> {
  const results = await Promise.all(
    ORDERABLE_CATEGORIES.map(async (cat) => {
      const order = await getDisplayOrder(personName, cat);
      return [cat, order] as [string, string[]];
    }),
  );
  return Object.fromEntries(results.filter(([, order]) => (order as string[]).length > 0));
}
