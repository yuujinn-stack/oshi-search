// /api/admin/rakuten-events — 楽天イベント管理（管理画面 /admin/rakuten-events）
//
// GET  ?eventId=N                                  → イベントと紐付けた商品
// POST { action: 'create', event, operator }        → イベントの登録
// POST { action: 'update', id, event, expectedUpdatedAt, operator } → 更新（画面で読んだ時点から変わっていなければ）
// POST { action: 'delete', id }                     → イベントと紐付けの削除（商品データは消さない）
// POST { action: 'search', personName?, groupName?, categories[], keyword, includeUnpublished, eventId? } → 既存商品の検索（読み取りのみ）
// POST { action: 'link', eventId, items[] }         → 商品の紐付け（「要確認」で開始）
// POST { action: 'update_link', eventId, linkId, link, operator } → 確認状態・確認元URL・確認日時・メモ
// POST { action: 'unlink', eventId, linkId }        → 紐付けの解除
// POST { action: 'check_item', eventId, linkId }    → 楽天APIで紐付けた商品1件の現在の情報を確認（表示のみ・products に保存しない）
// POST { action: 'check_items', items[] }            → 選んだ商品（最大20件）を楽天APIで確認（24時間のキャッシュがあれば呼ばない）
//
// 登録・更新では、同じ種類で期間が重なるイベント（5と0のつく日・マラソン・スーパーSALE・ブラックフライデー）、
// または同じ名前・開始日時のイベントを重複として保存しない（src/lib/rakuten-event/candidates.ts findDuplicateEvent）。
//
// proxy.ts の認証に加え、この処理でも管理者のセッションと Origin を確認する。products・verdicts には書き込まない。
// 一般公開ページは参照しないため、キャッシュの失効（revalidate）もしない。エラー文（秘密を含みうる）は返さない。
import { NextRequest, NextResponse } from 'next/server';
import { checkCsrfOrigin, SESSION_COOKIE, validateSecretStrength, verifySessionToken } from '@/lib/session';
import { validateEventInput, validateLinkUpdate, validateOperator } from '@/lib/rakuten-event/core';
import {
  MAX_LINK_PER_REQUEST, createEvent, deleteEvent, getEvent, getItemCodesFor, getLinkedItemCode, isMissingEventTable, linkProducts, linkTargetKey,
  listEventProducts, listEvents, neonEventDb, searchProducts, unlinkProduct, updateEvent, updateEventProduct, type EventDb, type LinkTarget,
} from '@/lib/rakuten-event/store';
import { ITEM_CHECK_MESSAGE, MAX_CHECK_PER_REQUEST, cachedCheckStates, checkRakutenItems } from '@/lib/rakuten-event/item-check';
import { findDuplicateEvent } from '@/lib/rakuten-event/candidates';
import { formatJstAdmin } from '@/lib/rakuten-event/core';
import { CATEGORIES } from '@/lib/product-store';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllMembershipRecords } from '@/lib/group-membership-store';
import { groupMembershipRecords, personsInGroup } from '@/lib/group-membership';

export const dynamic = 'force-dynamic';

async function isAdmin(req: NextRequest): Promise<boolean> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!validateSecretStrength(secret)) return false;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return (await verifySessionToken(token, secret)).valid;
}

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status });
const bad = (message: string, code = 'invalid_input') => json({ ok: false, code, message }, 400);
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 2 ** 31 ? v : null);

function failure(err: unknown) {
  if (isMissingEventTable(err)) {
    return json({ ok: false, code: 'table_missing', message: '楽天イベントのテーブルが未作成です（scripts/rakuten-events/setup-tables.ts で作成してください）' }, 503);
  }
  const e = err as { name?: string; code?: string } | null;
  console.error('[rakuten-events] failed:', e?.name ?? 'Error', e?.code ?? '');
  return json({ ok: false, code: 'error', message: '処理に失敗しました' }, 500);
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return json({ ok: false, code: 'unauthorized', message: '管理者としてログインしてください' }, 401);
  const eventId = posInt(Number(req.nextUrl.searchParams.get('eventId')));
  if (!eventId) return bad('eventId が正しくありません');
  try {
    const db = neonEventDb();
    const [event, products] = await Promise.all([getEvent(db, eventId), listEventProducts(db, eventId)]);
    if (!event) return json({ ok: false, code: 'not_found', message: 'イベントが見つかりません' }, 404);
    // 楽天APIの確認結果（24時間のキャッシュだけ。APIは呼ばない）
    const api = await cachedCheckStates(products.map((p) => p.itemCode));
    return json({ ok: true, event, products: products.map((p, i) => ({ ...p, api: api[i] })) });
  } catch (err) {
    return failure(err);
  }
}

/** 人物名・グループ名から検索対象の人物を決める（グループは所属履歴の現在・過去のメンバーを含む） */
async function resolveSearchPersons(personName: unknown, groupName: unknown): Promise<string[]> {
  if (typeof personName === 'string' && personName.trim()) return [personName.trim()];
  if (typeof groupName !== 'string' || !groupName.trim()) return [];
  const [persons, records] = await Promise.all([getAllPersonsMerged(), getAllMembershipRecords()]);
  return personsInGroup(groupName.trim(), persons, groupMembershipRecords(records)).map((p) => p.name);
}

async function duplicateMessage(db: EventDb, v: { name: string; eventType: Parameters<typeof findDuplicateEvent>[1]['eventType']; startsAt: number; endsAt: number }, excludeId?: number) {
  const dup = findDuplicateEvent(await listEvents(db), v, excludeId);
  return dup ? `同じイベントが登録済みです：「${dup.name}」（${formatJstAdmin(dup.startsAt)}〜${formatJstAdmin(dup.endsAt)}）。そちらを編集してください（保存していません）` : null;
}

function parseTargets(v: unknown): LinkTarget[] {
  return (Array.isArray(v) ? v : [])
    .map((i) => i as Record<string, unknown>)
    .filter((i) => typeof i.personName === 'string' && typeof i.productId === 'string' && (CATEGORIES as string[]).includes(String(i.category)))
    .map((i) => ({ personName: String(i.personName).slice(0, 200), category: String(i.category), productId: String(i.productId).slice(0, 300) }));
}

export async function POST(req: NextRequest) {
  if (!checkCsrfOrigin(req.headers.get('origin'), req.headers.get('host'))) {
    return json({ ok: false, code: 'forbidden', message: '不正なOriginです' }, 403);
  }
  if (!(await isAdmin(req))) return json({ ok: false, code: 'unauthorized', message: '管理者としてログインしてください' }, 401);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return bad('入力が正しくありません');
  const db = neonEventDb();
  try {
    switch (body.action) {
      case 'create': {
        const operator = validateOperator(body.operator);
        if (!operator) return bad('操作者名を50文字以内で入力してください');
        const v = validateEventInput(body.event);
        if (!v.ok) return bad(v.error);
        const dup = await duplicateMessage(db, v.value);
        if (dup) return json({ ok: false, code: 'duplicate', message: dup }, 409);
        const id = await createEvent(db, v.value, operator);
        return json({ ok: true, code: 'created', message: 'イベントを登録しました', id });
      }
      case 'update': {
        const id = posInt(body.id);
        const expected = typeof body.expectedUpdatedAt === 'number' ? body.expectedUpdatedAt : null;
        const operator = validateOperator(body.operator);
        if (!id || expected == null) return bad('入力が正しくありません');
        if (!operator) return bad('操作者名を50文字以内で入力してください');
        const v = validateEventInput(body.event);
        if (!v.ok) return bad(v.error);
        const dup = await duplicateMessage(db, v.value, id);
        if (dup) return json({ ok: false, code: 'duplicate', message: dup }, 409);
        const r = await updateEvent(db, id, v.value, operator, expected);
        if (r === 'not_found') return json({ ok: false, code: 'not_found', message: 'イベントが見つかりません' }, 404);
        if (r === 'conflict') return json({ ok: false, code: 'conflict', message: '他の画面で更新されています。再読み込みしてから編集してください（保存していません）' }, 409);
        return json({ ok: true, code: 'updated', message: 'イベントを更新しました' });
      }
      case 'delete': {
        const id = posInt(body.id);
        if (!id) return bad('入力が正しくありません');
        const ok = await deleteEvent(db, id);
        return ok ? json({ ok: true, code: 'deleted', message: 'イベントを削除しました（商品データは変わりません）' }) : json({ ok: false, code: 'not_found', message: 'イベントが見つかりません' }, 404);
      }
      case 'search': {
        const categories = Array.isArray(body.categories) ? body.categories.filter((c): c is string => typeof c === 'string' && (CATEGORIES as string[]).includes(c)) : [];
        const keyword = typeof body.keyword === 'string' ? body.keyword.slice(0, 100) : '';
        const persons = await resolveSearchPersons(body.personName, body.groupName);
        if (!persons.length) return bad('人物またはグループを選んでください');
        const r = await searchProducts(db, {
          personNames: persons, categories, keyword, includeUnpublished: body.includeUnpublished === true, eventId: posInt(body.eventId) ?? undefined,
        });
        const api = await cachedCheckStates(r.rows.map((x) => x.itemCode));
        return json({ ok: true, rows: r.rows.map((x, i) => ({ ...x, api: api[i] })), truncated: r.truncated, personCount: persons.length });
      }
      case 'link': {
        const eventId = posInt(body.eventId);
        const targets = parseTargets(body.items);
        if (!eventId || !targets.length) return bad('紐付ける商品を選んでください');
        if (targets.length > MAX_LINK_PER_REQUEST) return bad(`一度に紐付けられるのは${MAX_LINK_PER_REQUEST}件までです`);
        const r = await linkProducts(db, eventId, targets);
        return json({ ok: true, code: 'linked', message: `${r.linked}件を「要確認」で紐付けました${r.skipped ? `（${r.skipped}件は紐付け済み・商品が見つからないため追加なし）` : ''}`, ...r });
      }
      case 'update_link': {
        const eventId = posInt(body.eventId), linkId = posInt(body.linkId);
        const operator = validateOperator(body.operator);
        if (!eventId || !linkId) return bad('入力が正しくありません');
        if (!operator) return bad('操作者名を50文字以内で入力してください');
        const v = validateLinkUpdate(body.link);
        if (!v.ok) return bad(v.error);
        const ok = await updateEventProduct(db, linkId, eventId, v.value, operator);
        return ok ? json({ ok: true, code: 'updated', message: '確認状態を保存しました' }) : json({ ok: false, code: 'not_found', message: '紐付けが見つかりません' }, 404);
      }
      case 'unlink': {
        const eventId = posInt(body.eventId), linkId = posInt(body.linkId);
        if (!eventId || !linkId) return bad('入力が正しくありません');
        const ok = await unlinkProduct(db, linkId, eventId);
        return ok ? json({ ok: true, code: 'unlinked', message: '紐付けを解除しました（商品データは変わりません）' }) : json({ ok: false, code: 'not_found', message: '紐付けが見つかりません' }, 404);
      }
      case 'check_item': {
        const linkId = posInt(body.linkId);
        if (!linkId) return bad('入力が正しくありません');
        const item = await getLinkedItemCode(db, linkId);
        if (!item) return json({ ok: false, code: 'not_found', message: '紐付けた商品が商品データに見つかりません（削除・ID変更の可能性）' }, 404);
        const [r] = await checkRakutenItems([item.itemCode]);
        if (r.code === 'ok') return json({ ok: true, code: 'ok', info: r.info });
        return json({ ok: false, code: r.code, message: ITEM_CHECK_MESSAGE[r.code] }, r.code === 'no_item_code' || r.code === 'not_found' ? 200 : 503);
      }
      case 'check_items': {
        const targets = parseTargets(body.items);
        if (!targets.length) return bad('確認する商品を選んでください');
        if (targets.length > MAX_CHECK_PER_REQUEST) return bad(`楽天APIで一度に確認できるのは${MAX_CHECK_PER_REQUEST}件までです`);
        const codes = await getItemCodesFor(db, targets);
        const results = await checkRakutenItems(targets.map((t) => codes.get(linkTargetKey(t)) ?? null));
        const out = targets.map((t, i) => ({ ...t, result: results[i] }));
        const called = results.filter((r) => r.code === 'ok' || r.code === 'not_found').length;
        const stopped = results.find((r) => r.code === 'busy' || r.code === 'cooldown' || r.code === 'rate_limited' || r.code === 'unavailable' || r.code === 'config_missing');
        return json({
          ok: true, code: 'checked', results: out,
          message: stopped ? `${called}件を確認しました。${ITEM_CHECK_MESSAGE[stopped.code as keyof typeof ITEM_CHECK_MESSAGE]}` : `${called}件の結果を表示しています（商品コードの無い商品は確認できません）`,
        });
      }
      default:
        return bad('操作が正しくありません');
    }
  } catch (err) {
    return failure(err);
  }
}
