// Prime Video 追加チャンネル誤登録の一括修正（2026-10）の判定ロジック（純粋関数・DB非依存）。
//
// 実行スクリプト本体は ./run.ts。ここでは「最終確認済みCSVの1行」と「現在のDBの作品行」を突き合わせ、
//   - DB が CSV の修正前状態と完全一致する行だけを変更対象（pending）にする
//   - すでに修正後状態になっている行は already_applied（再実行しても二重に変更しない＝冪等）
//   - それ以外（想定外の状態）はすべて error として変更しない
// を判定する。provider を note から推測して書き換えることはしない（CSV に明記された変更だけを行う）。
import { parseCSV } from '@/lib/csv-parse';
import { isPrimeVideoChannel, normalizeProviderName } from '@/lib/vod-dedup';
import type { VodProvider, VodProviderType } from '@/types/vod';

export const FIX_ID = 'prime-video-channel-fix-2026-10';

/** 最終確認済みCSVの件数（少しでも違えば apply しない） */
export const EXPECTED = {
  totalRows: 158,
  changeRows: 141,
  changeUniqueWorks: 106,
  rename: 132,
  setUnknown: 8,
  setRent: 1,
  keep: 17,
} as const;

export type FixAction = 'rename' | 'set_unknown' | 'set_rent' | 'keep';

export interface PlanRow {
  lineNo: number;
  action: FixAction;
  personName: string;
  workId: string;
  canonicalWorkId: string;
  workTitle: string;
  currentProvider: string;
  availabilityType: string;
  source: string;
  note: string;
  sourceUrl: string;
  finalClassification: string;
  newProviderName: string;
  newAvailabilityType: string;
  officialSourceUrl: string;
  reason: string;
  confidence: string;
  needsManualReview: string;
}

const REQUIRED_COLUMNS = [
  'action', 'personName', 'workId', 'canonicalWorkId', 'workTitle', 'currentProvider', 'availabilityType',
  'source', 'note', 'sourceUrl', 'finalClassification', 'newProviderName', 'newAvailabilityType',
  'officialSourceUrl', 'reason', 'confidence', 'needsManualReview',
] as const;

const ACTIONS: FixAction[] = ['rename', 'set_unknown', 'set_rent', 'keep'];

export function parsePlanCsv(text: string): { rows: PlanRow[]; errors: string[] } {
  const table = parseCSV(text);
  const errors: string[] = [];
  if (table.length === 0) return { rows: [], errors: ['CSVが空です'] };
  const header = table[0].map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { rows: [], errors: [`必須列がありません: ${missing.join(', ')}`] };
  const col = (r: string[], name: string) => r[header.indexOf(name)] ?? '';
  const rows: PlanRow[] = [];
  table.slice(1).forEach((r, i) => {
    const lineNo = i + 2;
    const action = col(r, 'action').trim() as FixAction;
    if (!ACTIONS.includes(action)) { errors.push(`${lineNo}行目: action "${action}" は未対応です`); return; }
    rows.push({
      lineNo,
      action,
      personName: col(r, 'personName'),
      workId: col(r, 'workId'),
      canonicalWorkId: col(r, 'canonicalWorkId'),
      workTitle: col(r, 'workTitle'),
      currentProvider: col(r, 'currentProvider'),
      availabilityType: col(r, 'availabilityType'),
      source: col(r, 'source'),
      note: col(r, 'note'),
      sourceUrl: col(r, 'sourceUrl'),
      finalClassification: col(r, 'finalClassification'),
      newProviderName: col(r, 'newProviderName'),
      newAvailabilityType: col(r, 'newAvailabilityType'),
      officialSourceUrl: col(r, 'officialSourceUrl'),
      reason: col(r, 'reason'),
      confidence: col(r, 'confidence'),
      needsManualReview: col(r, 'needsManualReview'),
    });
  });
  return { rows, errors };
}

/** CSV行そのものの妥当性（DBを見る前に検査） */
export function validatePlanRow(row: PlanRow): string | null {
  if (!row.personName || !row.workId || !row.canonicalWorkId) return 'personName / workId / canonicalWorkId が空です';
  if (normalizeProviderName(row.currentProvider) !== 'primevideo') return `currentProvider "${row.currentProvider}" が Prime Video 本体ではありません`;
  if (row.availabilityType !== 'flatrate') return `availabilityType "${row.availabilityType}" が flatrate ではありません`;
  switch (row.action) {
    case 'rename':
      if (row.finalClassification !== 'B') return `rename なのに分類が B ではありません（${row.finalClassification}）`;
      if (!row.newProviderName || normalizeProviderName(row.newProviderName) === 'primevideo' || !isPrimeVideoChannel(row.newProviderName)) {
        return `newProviderName "${row.newProviderName}" が Prime Video 追加チャンネル名として認識されません`;
      }
      if (row.newAvailabilityType !== row.availabilityType) return 'rename で配信種別が変わっています';
      return null;
    case 'set_unknown':
      if (row.finalClassification !== 'D') return `set_unknown なのに分類が D ではありません（${row.finalClassification}）`;
      if (row.newAvailabilityType !== 'unknown') return 'set_unknown の newAvailabilityType が unknown ではありません';
      if (row.newProviderName !== row.currentProvider) return 'set_unknown で provider 名が変わっています';
      return null;
    case 'set_rent':
      if (row.finalClassification !== 'D') return `set_rent なのに分類が D ではありません（${row.finalClassification}）`;
      if (row.newAvailabilityType !== 'rent') return 'set_rent の newAvailabilityType が rent ではありません';
      if (row.newProviderName !== row.currentProvider) return 'set_rent で provider 名が変わっています';
      return null;
    case 'keep':
      if (row.finalClassification !== 'A') return `keep なのに分類が A ではありません（${row.finalClassification}）`;
      return null;
  }
}

/** 変更後の provider 名・配信種別 */
export function targetOf(row: PlanRow): { providerName: string; type: string } {
  switch (row.action) {
    case 'rename': return { providerName: row.newProviderName, type: row.availabilityType };
    case 'set_unknown': return { providerName: row.currentProvider, type: 'unknown' };
    case 'set_rent': return { providerName: row.currentProvider, type: 'rent' };
    case 'keep': return { providerName: row.currentProvider, type: row.availabilityType };
  }
}

/** provider エントリ1件に今回の変更を適用する（元のオブジェクトは変更しない） */
export function applyChange(p: VodProvider, row: PlanRow, now: number): VodProvider {
  const t = targetOf(row);
  if (row.action === 'rename') {
    // Prime Video 本体の TMDb ロゴ・providerId を引き継ぐと、チャンネルなのに Prime のロゴが表示されるため外す
    // （ChatGPT一括同期の手動登録エントリと同じ providerId=-1・logoPath なし。ロゴは ProviderLogo が名前から解決する）
    const { logoPath: _logoPath, ...rest } = p;
    return { ...rest, providerName: t.providerName, providerId: -1, updatedAt: now };
  }
  return { ...p, type: t.type as VodProviderType, updatedAt: now };
}

const sameNote = (p: VodProvider, note: string) => (p.note ?? '') === note;

function matches(p: VodProvider, row: PlanRow, providerName: string, type: string): boolean {
  return p.providerName === providerName && p.type === type && p.source === row.source && sameNote(p, row.note);
}

export interface DbWorkRow {
  personName: string;
  id: string;
  deleted: boolean;
  vodData: Record<string, unknown>;
  /** work_aliases での正規ID（エイリアスでなければ null） */
  aliasCanonicalWorkId: string | null;
}

export type RowStatus = 'pending' | 'already_applied' | 'unchanged_keep' | 'error';

export interface RowResult {
  plan: PlanRow;
  status: RowStatus;
  message?: string;
  providerIndex?: number;
  before?: VodProvider;
}

export function providersOf(vodData: Record<string, unknown>): VodProvider[] {
  return Array.isArray(vodData.vodProviders) ? (vodData.vodProviders as VodProvider[]) : [];
}

/** CSV1行を現在のDB行と突き合わせる */
export function evaluatePlanRow(row: PlanRow, db: DbWorkRow | undefined): RowResult {
  const invalid = validatePlanRow(row);
  if (invalid) return { plan: row, status: 'error', message: invalid };
  if (!db) return { plan: row, status: 'error', message: 'DBに該当する作品行（personName + workId）がありません' };
  if (db.deleted) return { plan: row, status: 'error', message: 'DBの作品行が削除済み（deleted=true）です' };
  const canonical = db.aliasCanonicalWorkId ?? db.id;
  if (canonical !== row.canonicalWorkId) {
    return { plan: row, status: 'error', message: `canonicalWorkId が一致しません（DB: ${canonical} / CSV: ${row.canonicalWorkId}）` };
  }
  const providers = providersOf(db.vodData);
  const beforeIdx = providers.flatMap((p, i) => (matches(p, row, row.currentProvider, row.availabilityType) ? [i] : []));
  if (beforeIdx.length > 1) return { plan: row, status: 'error', message: `修正前状態に一致する provider が ${beforeIdx.length} 件あり特定できません` };

  if (row.action === 'keep') {
    if (beforeIdx.length === 1) return { plan: row, status: 'unchanged_keep', providerIndex: beforeIdx[0], before: providers[beforeIdx[0]] };
    return { plan: row, status: 'error', message: '維持対象の Prime Video 行がDBに見つかりません' };
  }

  if (beforeIdx.length === 1) {
    const before = providers[beforeIdx[0]];
    if (before.hidden) return { plan: row, status: 'error', message: '対象 provider が非表示（hidden）になっています' };
    return { plan: row, status: 'pending', providerIndex: beforeIdx[0], before };
  }
  const t = targetOf(row);
  const afterIdx = providers.flatMap((p, i) => (matches(p, row, t.providerName, t.type) ? [i] : []));
  if (afterIdx.length === 1) return { plan: row, status: 'already_applied', providerIndex: afterIdx[0], before: providers[afterIdx[0]] };
  return { plan: row, status: 'error', message: '修正前状態にも修正後状態にも一致する provider がありません（DBが想定外の状態）' };
}

export interface PlanSummary {
  totalRows: number;
  changeRows: number;
  changeUniqueWorks: number;
  byAction: Record<FixAction, number>;
  byStatus: Record<RowStatus, number>;
  pendingByAction: Record<FixAction, number>;
  workRowsToUpdate: number;
  errors: RowResult[];
  /** 件数・状態の検査結果（空なら apply 可能） */
  blockers: string[];
}

export function summarize(results: RowResult[]): PlanSummary {
  const byAction = { rename: 0, set_unknown: 0, set_rent: 0, keep: 0 } as Record<FixAction, number>;
  const pendingByAction = { rename: 0, set_unknown: 0, set_rent: 0, keep: 0 } as Record<FixAction, number>;
  const byStatus = { pending: 0, already_applied: 0, unchanged_keep: 0, error: 0 } as Record<RowStatus, number>;
  const changeWorks = new Set<string>();
  const workRows = new Set<string>();
  const blockers: string[] = [];

  // 同じ provider エントリを2行以上が対象にしていないか
  const seenTarget = new Map<string, number>();
  for (const r of results) {
    byAction[r.plan.action]++;
    byStatus[r.status]++;
    if (r.plan.action !== 'keep') changeWorks.add(r.plan.canonicalWorkId);
    if (r.status === 'pending') {
      pendingByAction[r.plan.action]++;
      workRows.add(`${r.plan.personName}\u0000${r.plan.workId}`);
    }
    if (r.providerIndex != null) {
      const key = `${r.plan.personName}\u0000${r.plan.workId}\u0000${r.providerIndex}`;
      const prev = seenTarget.get(key);
      if (prev != null) blockers.push(`${prev}行目と${r.plan.lineNo}行目が同じ provider エントリを対象にしています`);
      else seenTarget.set(key, r.plan.lineNo);
    }
  }
  const changeRows = results.length - byAction.keep;

  const expect = (label: string, actual: number, expected: number) => {
    if (actual !== expected) blockers.push(`${label}: ${actual}（想定 ${expected}）`);
  };
  expect('CSV総行数', results.length, EXPECTED.totalRows);
  expect('変更行数', changeRows, EXPECTED.changeRows);
  expect('変更対象のユニーク作品数', changeWorks.size, EXPECTED.changeUniqueWorks);
  expect('rename', byAction.rename, EXPECTED.rename);
  expect('set_unknown', byAction.set_unknown, EXPECTED.setUnknown);
  expect('set_rent', byAction.set_rent, EXPECTED.setRent);
  expect('keep', byAction.keep, EXPECTED.keep);
  expect('維持（keep）でDB一致', byStatus.unchanged_keep, EXPECTED.keep);
  expect('変更行のうち 修正前一致 + 適用済み', byStatus.pending + byStatus.already_applied, EXPECTED.changeRows);
  if (byStatus.error > 0) blockers.push(`エラー ${byStatus.error} 件`);

  return {
    totalRows: results.length,
    changeRows,
    changeUniqueWorks: changeWorks.size,
    byAction,
    byStatus,
    pendingByAction,
    workRowsToUpdate: workRows.size,
    errors: results.filter((r) => r.status === 'error'),
    blockers,
  };
}

/** pending の変更を作品行ごとにまとめ、新しい vod_data を作る */
export function buildWorkRowUpdates(
  results: RowResult[],
  dbRows: Map<string, DbWorkRow>,
  now: number,
): { key: string; personName: string; workId: string; before: Record<string, unknown>; after: Record<string, unknown>; changes: RowResult[] }[] {
  const grouped = new Map<string, RowResult[]>();
  for (const r of results) {
    if (r.status !== 'pending') continue;
    const key = `${r.plan.personName}\u0000${r.plan.workId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), r]);
  }
  return [...grouped.entries()].map(([key, changes]) => {
    const db = dbRows.get(key)!;
    const providers = providersOf(db.vodData).slice();
    for (const c of changes) providers[c.providerIndex!] = applyChange(providers[c.providerIndex!], c.plan, now);
    return { key, personName: db.personName, workId: db.id, before: db.vodData, after: { ...db.vodData, vodProviders: providers }, changes };
  });
}

// ── 復元（ロールバック） ────────────────────────────────────────────────

export interface BackupEntry {
  personName: string;
  workId: string;
  canonicalWorkId: string;
  action: FixAction;
  /** 修正前の provider エントリ（完全なJSON） */
  providerBefore: VodProvider;
  /** 修正後に期待される provider 名・種別（復元時の特定に使う） */
  expectedAfterProviderName: string;
  expectedAfterType: string;
}

export type RollbackStatus = 'pending' | 'already_restored' | 'error';

/** バックアップ1件を現在のDB行と突き合わせる（今回の変更だけを元に戻す） */
export function evaluateRollbackEntry(
  e: BackupEntry,
  db: DbWorkRow | undefined,
): { entry: BackupEntry; status: RollbackStatus; providerIndex?: number; message?: string } {
  if (!db) return { entry: e, status: 'error', message: 'DBに該当する作品行がありません' };
  const providers = providersOf(db.vodData);
  const note = e.providerBefore.note ?? '';
  const find = (name: string, type: string) =>
    providers.flatMap((p, i) => (p.providerName === name && p.type === type && p.source === e.providerBefore.source && (p.note ?? '') === note ? [i] : []));
  const after = find(e.expectedAfterProviderName, e.expectedAfterType);
  if (after.length === 1) return { entry: e, status: 'pending', providerIndex: after[0] };
  if (after.length > 1) return { entry: e, status: 'error', message: '修正後状態に一致する provider が複数あります' };
  const before = find(e.providerBefore.providerName, e.providerBefore.type);
  if (before.length === 1) return { entry: e, status: 'already_restored', providerIndex: before[0] };
  return { entry: e, status: 'error', message: '修正後状態・修正前状態のどちらにも一致しません（DBが想定外の状態）' };
}
