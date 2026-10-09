import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  EXPECTED,
  applyChange,
  buildWorkRowUpdates,
  evaluatePlanRow,
  evaluateRollbackEntry,
  parsePlanCsv,
  summarize,
  type DbWorkRow,
  type PlanRow,
} from './plan';
import type { VodProvider } from '@/types/vod';

const row = (o: Partial<PlanRow> = {}): PlanRow => ({
  lineNo: 2,
  action: 'rename',
  personName: '目黒蓮',
  workId: 'w1',
  canonicalWorkId: 'w1',
  workTitle: '作品',
  currentProvider: 'Prime Video',
  availabilityType: 'flatrate',
  source: 'manual_csv',
  note: 'Prime Video内のFODチャンネルで配信',
  sourceUrl: '',
  finalClassification: 'B',
  newProviderName: 'FOD Channel Amazon Channel',
  newAvailabilityType: 'flatrate',
  officialSourceUrl: '',
  reason: '',
  confidence: 'high',
  needsManualReview: 'false',
  ...o,
});

const prime = (o: Partial<VodProvider> = {}): VodProvider => ({
  providerId: 9,
  providerName: 'Prime Video',
  logoPath: '/prime.jpg',
  type: 'flatrate',
  countryCode: 'JP',
  source: 'manual_csv',
  note: 'Prime Video内のFODチャンネルで配信',
  ...o,
});

const db = (providers: VodProvider[], o: Partial<DbWorkRow> = {}): DbWorkRow => ({
  personName: '目黒蓮',
  id: 'w1',
  deleted: false,
  vodData: { vodProviders: providers, vodStatus: 'found' },
  aliasCanonicalWorkId: null,
  ...o,
});

describe('evaluatePlanRow（DBが修正前状態と完全一致する行だけを変更）', () => {
  it('完全一致 → pending', () => {
    const r = evaluatePlanRow(row(), db([prime({ providerName: 'U-NEXT', note: '' }), prime()]));
    expect(r.status).toBe('pending');
    expect(r.providerIndex).toBe(1);
  });

  it('note / source / 種別が違う・行がない・削除済み・canonical 不一致 → error（変更しない）', () => {
    expect(evaluatePlanRow(row(), db([prime({ note: '別の記述' })])).status).toBe('error');
    expect(evaluatePlanRow(row(), db([prime({ source: 'ai_recheck' })])).status).toBe('error');
    expect(evaluatePlanRow(row(), db([prime({ type: 'rent' })])).status).toBe('error');
    expect(evaluatePlanRow(row(), undefined).status).toBe('error');
    expect(evaluatePlanRow(row(), db([prime()], { deleted: true })).status).toBe('error');
    expect(evaluatePlanRow(row(), db([prime()], { aliasCanonicalWorkId: 'w0' })).status).toBe('error');
    expect(evaluatePlanRow(row(), db([prime(), prime()])).status).toBe('error');
    expect(evaluatePlanRow(row(), db([prime({ hidden: true })])).status).toBe('error');
  });

  it('適用済み（修正後状態）→ already_applied（冪等）', () => {
    const applied = applyChange(prime(), row(), 1);
    expect(evaluatePlanRow(row(), db([applied])).status).toBe('already_applied');
    const unknown = row({ action: 'set_unknown', finalClassification: 'D', newProviderName: 'Prime Video', newAvailabilityType: 'unknown' });
    expect(evaluatePlanRow(unknown, db([prime({ type: 'unknown' })])).status).toBe('already_applied');
  });

  it('CSV側の不正（チャンネル名でない rename 先・分類の食い違い）→ error', () => {
    expect(evaluatePlanRow(row({ newProviderName: 'Prime Video' }), db([prime()])).status).toBe('error');
    expect(evaluatePlanRow(row({ newProviderName: 'FOD' }), db([prime()])).status).toBe('error');
    expect(evaluatePlanRow(row({ finalClassification: 'A' }), db([prime()])).status).toBe('error');
    expect(evaluatePlanRow(row({ action: 'set_rent', finalClassification: 'D', newProviderName: 'Prime Video', newAvailabilityType: 'unknown' }), db([prime()])).status).toBe('error');
  });

  it('keep は一致すれば unchanged_keep、無ければ error', () => {
    const keep = row({ action: 'keep', finalClassification: 'A', newProviderName: 'Prime Video' });
    expect(evaluatePlanRow(keep, db([prime()])).status).toBe('unchanged_keep');
    expect(evaluatePlanRow(keep, db([])).status).toBe('error');
  });
});

describe('applyChange / buildWorkRowUpdates', () => {
  it('rename は Prime の logoPath・providerId を外し、他の項目と他の provider は維持', () => {
    const other = prime({ providerName: 'U-NEXT', providerId: 84, note: '' });
    const dbRow = db([other, prime()]);
    const results = [evaluatePlanRow(row(), dbRow)];
    const [u] = buildWorkRowUpdates(results, new Map([['目黒蓮\u0000w1', dbRow]]), 123);
    const after = u.after.vodProviders as VodProvider[];
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(other);
    expect(after[1]).toEqual({ providerId: -1, providerName: 'FOD Channel Amazon Channel', type: 'flatrate', countryCode: 'JP', source: 'manual_csv', note: 'Prime Video内のFODチャンネルで配信', updatedAt: 123 });
    expect(u.after.vodStatus).toBe('found');
    expect((dbRow.vodData.vodProviders as VodProvider[])[1].providerName).toBe('Prime Video'); // 元データは変更しない
  });

  it('set_unknown / set_rent は配信種別だけ変更（削除しない）', () => {
    const unknown = row({ action: 'set_unknown', finalClassification: 'D', newProviderName: 'Prime Video', newAvailabilityType: 'unknown' });
    expect(applyChange(prime(), unknown, 1)).toMatchObject({ providerName: 'Prime Video', type: 'unknown', logoPath: '/prime.jpg', providerId: 9 });
    const rent = row({ action: 'set_rent', finalClassification: 'D', newProviderName: 'Prime Video', newAvailabilityType: 'rent' });
    expect(applyChange(prime(), rent, 1)).toMatchObject({ providerName: 'Prime Video', type: 'rent' });
  });
});

describe('evaluateRollbackEntry（今回の変更だけを戻す）', () => {
  const entry = { personName: '目黒蓮', workId: 'w1', canonicalWorkId: 'w1', action: 'rename' as const, providerBefore: prime(), expectedAfterProviderName: 'FOD Channel Amazon Channel', expectedAfterType: 'flatrate' };
  it('修正後状態 → pending、修正前状態 → already_restored、どちらでもない → error', () => {
    expect(evaluateRollbackEntry(entry, db([applyChange(prime(), row(), 1)])).status).toBe('pending');
    expect(evaluateRollbackEntry(entry, db([prime()])).status).toBe('already_restored');
    expect(evaluateRollbackEntry(entry, db([prime({ note: '別' })])).status).toBe('error');
  });
});

describe('最終確認済みCSV（scripts/data）', () => {
  it('件数が想定どおりで、CSV単体の検査でエラーがない', () => {
    const text = fs.readFileSync(path.join(__dirname, '../data/prime-video-channel-fix-2026-10.csv'), 'utf-8');
    const { rows, errors } = parsePlanCsv(text);
    expect(errors).toEqual([]);
    // DB を使わず「全行が修正前状態に一致した」と仮定した集計（件数検査のみ）
    const results = rows.map((r) => ({ plan: r, status: r.action === 'keep' ? 'unchanged_keep' as const : 'pending' as const }));
    const s = summarize(results);
    expect(s.blockers).toEqual([]);
    expect(s.changeRows).toBe(EXPECTED.changeRows);
    expect(s.changeUniqueWorks).toBe(EXPECTED.changeUniqueWorks);
    for (const r of rows) {
      const fake = db([prime({ providerName: r.currentProvider, note: r.note || undefined, source: r.source as VodProvider['source'] })], { personName: r.personName, id: r.workId, aliasCanonicalWorkId: r.canonicalWorkId === r.workId ? null : r.canonicalWorkId });
      const e = evaluatePlanRow(r, fake);
      expect(e.status, `${r.lineNo}行目 ${e.message ?? ''}`).toBe(r.action === 'keep' ? 'unchanged_keep' : 'pending');
    }
  });
});
