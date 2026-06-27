import { NextRequest, NextResponse } from 'next/server';
import { getAllDisplayOrders, saveDisplayOrder } from '@/lib/product-order-store';

export async function GET(req: NextRequest) {
  const person = req.nextUrl.searchParams.get('person');
  if (!person) return NextResponse.json({ error: 'person required' }, { status: 400 });
  const orders = await getAllDisplayOrders(person);
  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !body.personName || !body.category || !Array.isArray(body.order)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { personName, category, order } = body as {
    personName: string;
    category: string;
    order: string[];
  };
  await saveDisplayOrder(personName, category, order);
  return NextResponse.json({ ok: true });
}
