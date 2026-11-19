import { describe, it, expect } from 'vitest';
import {
  buildImportPreview,
  buildSavePlan,
  parseVodImportCsv,
  validateApprovals,
  type ImportWork,
  type RawCsvRow,
} from '../vod-csv-import';
import type { VodProvider } from '@/types/vod';

const NOW = new Date('2026-11-19T03:00:00.000Z');
const SOTA = 'SOTA';
const OTHER = '別人物';
const WORK = 'tmdb-movie-2be';
const PRIME_URL = 'https://www.primevideo.com/-/ja/detail/0FMB0185GE1LP306GC0IP0KWFA';

const prov = (o: Partial<VodProvider>): VodProvider => ({
  providerId: 9, providerName: 'Prime Video', type: 'flatrate', countryCode: 'JP', source: 'manual_csv', ...o,
});
const work = (personName: string, id: string, providers: VodProvider[], title = 'BE:FIRST DOME TOUR 2024-2025 "2:BE"'): ImportWork => ({
  id, personName, title, vodData: { vodProviders: providers, vodUpdatedAt: 1 },
});
const mapOf = (...works: ImportWork[]) => new Map(works.map((w) => [`${w.personName}:${w.id}`, w]));

function rows(csv: string, person = ''): RawCsvRow[] {
  const parsed = parseVodImportCsv(csv, person);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.rows;
}

const HEADER = 'workId,personId,vodService,availabilityType,confidence,sourceUrl,note';
/** 以前「チャンネル疑い」になっていた、否定形の記述を含む正しい見放題行 */
const ROW_OK_NEGATED = `${WORK},${SOTA},Prime Video,flatrate,high,${PRIME_URL},プライム会員は追加料金なしで視聴可能。追加チャンネル契約は不要`;
/** 判定不能（見放題の記述とチャンネル配信の記述が混在）→ 保留・承認対象 */
const ROW_AMBIGUOUS = `${WORK},${SOTA},Prime Video,flatrate,high,${PRIME_URL},プライム会員特典対象。Prime Videoチャンネルでも配信`;
/** 追加チャンネル */
const ROW_CHANNEL = `${WORK},${SOTA},Prime Video,flatrate,high,,Prime Video内のNHKオンデマンドチャンネルで配信。別途チャンネル契約が必要`;

const approvalFor = (row: { rowNum: number; workId: string; personName: string; vodService: string }, o: Partial<{ officialUrl: string; reason: string }> = {}) => ({
  rowNum: row.rowNum, workId: row.workId, personName: row.personName, vodService: row.vodService,
  officialUrl: PRIME_URL, reason: 'Prime Video公式でプライム会員向けの視聴案内を確認', ...o,
});

function save(preview: ReturnType<typeof buildImportPreview>, approvals: unknown, workMap: Map<string, ImportWork>) {
  const v = validateApprovals(preview.previewRows, approvals);
  if (!v.ok) throw new Error(v.error);
  return buildSavePlan(preview, v.approved, workMap, NOW);
}
const providersOf = (plan: ReturnType<typeof buildSavePlan>, person: string, id: string) =>
  (plan.worksToUpdate.find((w) => w.personName === person && w.id === id)?.vodData.vodProviders ?? []) as VodProvider[];

describe('誤検知の解消：否定形の記述を含む Prime Video 見放題行', () => {
  it('「追加料金なし」「追加チャンネル契約は不要」は保留にならず、そのまま追加できる', () => {
    const map = mapOf(work(SOTA, WORK, []));
    const preview = buildImportPreview(rows(`${HEADER}\n${ROW_OK_NEGATED}`), map, true);
    expect(preview.previewRows[0].action).toBe('add');
    expect(preview.suspectedChannelCount).toBe(0);
  });
});

describe('1. Prime Video の正しい見放題作品を承認して保存できる', () => {
  it('保留行を承認すると flatrate の Prime Video として承認記録つきで保存される', () => {
    const map = mapOf(work(SOTA, WORK, [prov({ providerName: 'U-NEXT', providerId: 97, source: 'tmdb_watch_provider' })]));
    const preview = buildImportPreview(rows(`${HEADER}\n${ROW_AMBIGUOUS}`), map, true);
    const held = preview.previewRows[0];
    expect(held.action).toBe('suspected_channel');
    expect(held.hold).toMatchObject({ category: 'ambiguous', approvable: true, approvedAction: 'add' });

    const plan = save(preview, [approvalFor(held)], map);
    expect(plan.approvedProviderCount).toBe(1);
    expect(plan.heldProviderCount).toBe(0);
    const saved = providersOf(plan, SOTA, WORK);
    const prime = saved.find((p) => p.providerName === 'Prime Video')!;
    expect(prime).toMatchObject({ type: 'flatrate', source: 'manual_csv', providerId: 9, confidence: 'high' });
    expect(prime.manualApproval).toEqual({
      kind: 'prime_video_included',
      officialUrl: PRIME_URL,
      reason: 'Prime Video公式でプライム会員向けの視聴案内を確認',
      approvedAt: NOW.toISOString(),
      heldCategory: 'ambiguous',
    });
    // TMDb 由来は保持
    expect(saved.find((p) => p.source === 'tmdb_watch_provider')).toBeTruthy();
  });

  it('同名の TMDb 由来 Prime Video が既にある場合は承認してもスキップ（重複させない）', () => {
    const map = mapOf(work(SOTA, WORK, [prov({ source: 'tmdb_watch_provider' })]));
    const preview = buildImportPreview(rows(`${HEADER}\n${ROW_AMBIGUOUS}`), map, false);
    expect(preview.previewRows[0].hold?.approvedAction).toBe('skip');
    const plan = save(preview, [approvalFor(preview.previewRows[0])], map);
    expect(plan.worksToUpdate).toHaveLength(0);
    expect(plan.approvedSkippedCount).toBe(1);
  });
});

describe('2. 追加チャンネル作品は未承認のまま登録できない', () => {
  it('未承認の保留行は保存されず、既存データも変わらない', () => {
    const map = mapOf(work(SOTA, WORK, []));
    const preview = buildImportPreview(rows(`${HEADER}\n${ROW_CHANNEL}`), map, false);
    expect(preview.previewRows[0]).toMatchObject({ action: 'suspected_channel', hold: { category: 'channel' } });
    const plan = save(preview, [], map);
    expect(plan.worksToUpdate).toHaveLength(0);
    expect(plan.heldProviderCount).toBe(1);
  });

  it('チャンネルページの URL を根拠に承認することはできない', () => {
    const map = mapOf(work(SOTA, WORK, []));
    const preview = buildImportPreview(rows(`${HEADER}\n${ROW_CHANNEL}`), map, false);
    const v = validateApprovals(preview.previewRows, [approvalFor(preview.previewRows[0], { officialUrl: 'https://www.amazon.co.jp/gp/video/channel/abc' })]);
    expect(v.ok).toBe(false);
  });

  it('種別がレンタル等の Prime 行を「見放題」として承認することはできない', () => {
    const map = mapOf(work(SOTA, WORK, []));
    const preview = buildImportPreview(rows(`${HEADER}\n${WORK},${SOTA},Prime Video,unknown,high,,NHKオンデマンドチャンネルで配信`), map, false);
    expect(preview.previewRows[0].hold?.approvable).toBe(false);
    expect(validateApprovals(preview.previewRows, [approvalFor(preview.previewRows[0])]).ok).toBe(false);
  });

  it('C: 種別 flatrate だが記述がレンタルのみ → 保留（見放題として登録しない）', () => {
    const map = mapOf(work(SOTA, WORK, []));
    const preview = buildImportPreview(rows(`${HEADER}\n${WORK},${SOTA},Prime Video,flatrate,high,,レンタルのみ（330円）`), map, false);
    expect(preview.previewRows[0].hold?.category).toBe('rental');
    expect(save(preview, [], map).worksToUpdate).toHaveLength(0);
  });

  it('種別が rent の Prime Video 行はレンタルとして通常どおり登録できる', () => {
    const map = mapOf(work(SOTA, WORK, []));
    const preview = buildImportPreview(rows(`${HEADER}\n${WORK},${SOTA},Prime Video,rent,high,,レンタル330円`), map, false);
    expect(preview.previewRows[0].action).toBe('add');
    const plan = save(preview, [], map);
    expect(providersOf(plan, SOTA, WORK)[0].type).toBe('rent');
  });
});

describe('3. 承認を取り消すと再び保留になる', () => {
  it('承認なしで保存すると保留のまま（承認状態は保存リクエストの approvals だけで決まる）', () => {
    const map = mapOf(work(SOTA, WORK, []));
    const preview = buildImportPreview(rows(`${HEADER}\n${ROW_AMBIGUOUS}`), map, false);
    const approved = save(preview, [approvalFor(preview.previewRows[0])], map);
    expect(approved.approvedProviderCount).toBe(1);
    const revoked = save(preview, [], map);
    expect(revoked.worksToUpdate).toHaveLength(0);
    expect(revoked.heldProviderCount).toBe(1);
  });
});

describe('4. 同期モードで既存の正しいデータが誤削除されない', () => {
  const existing = () => work(SOTA, WORK, [
    prov({ providerName: 'Prime Video', note: '前回CSVで登録' }),
    prov({ providerName: 'Hulu', providerId: 15 }),
    prov({ providerName: 'U-NEXT', providerId: 97, source: 'tmdb_watch_provider' }),
    prov({ providerName: 'Netflix', providerId: 8, source: 'openai_web_search' }),
    prov({ providerName: 'Disney+', providerId: 337, source: 'manual' }),
  ]);

  it('未承認の保留行のサービスは削除対象にならず、他の削除も見送られる', () => {
    const map = mapOf(existing());
    const preview = buildImportPreview(rows(`${HEADER}\n${ROW_AMBIGUOUS}`), map, true);
    const deletes = preview.previewRows.filter((r) => r.action === 'delete').map((r) => r.vodService);
    expect(deletes).toEqual(['Hulu']); // Prime Video（保留中）は削除対象にしない。TMDb/AI/manual も対象外
    const plan = save(preview, [], map);
    expect(plan.suppressedDeleteCount).toBe(1);
    expect(plan.deleteBlockedReason).toContain('未承認の保留1件');
    expect(plan.worksToUpdate).toHaveLength(0); // 何も変更しない
  });

  it('保留行を承認すると、承認行が保存され CSV にない manual_csv だけが削除される（TMDb・AI・manual は保護）', () => {
    const map = mapOf(existing());
    const preview = buildImportPreview(rows(`${HEADER}\n${ROW_AMBIGUOUS}`), map, true);
    const held = preview.previewRows.find((r) => r.action === 'suspected_channel')!;
    expect(held.hold?.approvedAction).toBe('update');
    const plan = save(preview, [approvalFor(held)], map);
    expect(plan.deletedProviderCount).toBe(1);
    const names = providersOf(plan, SOTA, WORK).map((p) => `${p.providerName}:${p.source}`).sort();
    expect(names).toEqual(['Disney+:manual', 'Netflix:openai_web_search', 'Prime Video:manual_csv', 'U-NEXT:tmdb_watch_provider']);
  });

  it('エラー行が残っている場合は削除を実行しない（追加・更新は行う）', () => {
    const map = mapOf(existing());
    const csv = `${HEADER}\n${WORK},${SOTA},Prime Video,flatrate,high,,プライム会員特典\nno-such-work,${SOTA},Hulu,flatrate,high,,`;
    const preview = buildImportPreview(rows(csv), map, true);
    expect(preview.errorCount).toBe(1);
    const plan = save(preview, [], map);
    expect(plan.deletedProviderCount).toBe(0);
    expect(plan.suppressedDeleteCount).toBe(1);
    expect(providersOf(plan, SOTA, WORK).some((p) => p.providerName === 'Hulu')).toBe(true);
    expect(plan.savedProviderCount).toBe(1);
  });

  it('保留・エラーが無ければ従来どおり CSV にない manual_csv を削除する', () => {
    const map = mapOf(existing());
    const preview = buildImportPreview(rows(`${HEADER}\n${ROW_OK_NEGATED}`), map, true);
    const plan = save(preview, [], map);
    expect(plan.deletedProviderCount).toBe(1);
    expect(plan.deleteBlockedReason).toBeNull();
  });
});

describe('5. 同一CSVの再インポートで重複しない', () => {
  it('承認して保存 → 同じCSVを再度承認して保存しても Prime Video は1件', () => {
    let map = mapOf(work(SOTA, WORK, []));
    const csv = `${HEADER}\n${ROW_AMBIGUOUS}`;
    for (let i = 0; i < 2; i++) {
      const preview = buildImportPreview(rows(csv), map, true);
      const held = preview.previewRows.find((r) => r.action === 'suspected_channel')!;
      expect(held.hold?.approvedAction).toBe(i === 0 ? 'add' : 'update');
      const plan = save(preview, [approvalFor(held)], map);
      const w = plan.worksToUpdate[0];
      map = mapOf({ id: w.id, personName: w.personName, title: 'x', vodData: w.vodData });
    }
    const providers = (map.get(`${SOTA}:${WORK}`)!.vodData.vodProviders as VodProvider[]);
    expect(providers.filter((p) => p.providerName === 'Prime Video')).toHaveLength(1);
  });

  it('再インポートで保留のまま（未承認）でも既存の承認済みデータは削除・変更されない', () => {
    const approvedExisting = prov({ manualApproval: { kind: 'prime_video_included', officialUrl: PRIME_URL, reason: '確認済みです', approvedAt: '2026-11-01T00:00:00.000Z', heldCategory: 'ambiguous' } });
    const map = mapOf(work(SOTA, WORK, [approvedExisting]));
    const preview = buildImportPreview(rows(`${HEADER}\n${ROW_AMBIGUOUS}`), map, true);
    expect(preview.deleteCount).toBe(0);
    expect(save(preview, [], map).worksToUpdate).toHaveLength(0);
  });
});

describe('6. 別人物のデータに影響しない', () => {
  it('同じ workId を持つ別人物の作品は更新・削除の対象にならない', () => {
    const map = mapOf(
      work(SOTA, WORK, [prov({ providerName: 'Hulu', providerId: 15 })]),
      work(OTHER, WORK, [prov({ providerName: 'Hulu', providerId: 15 }), prov({ providerName: 'Prime Video' })]),
    );
    const preview = buildImportPreview(rows(`${HEADER}\n${ROW_AMBIGUOUS}`), map, true);
    expect(preview.previewRows.every((r) => r.personName === SOTA)).toBe(true);
    const plan = save(preview, [approvalFor(preview.previewRows.find((r) => r.action === 'suspected_channel')!)], map);
    expect(plan.worksToUpdate.map((w) => w.personName)).toEqual([SOTA]);
  });

  it('personId 列が無い CSV は画面で選んだ人物だけが対象', () => {
    const parsed = rows(`workId,vodService,availabilityType,note\n${WORK},Prime Video,flatrate,プライム会員特典`, SOTA);
    expect(parsed[0].personName).toBe(SOTA);
  });
});

describe('7. 承認情報の改ざんによる検証回避ができない', () => {
  const setup = () => {
    const map = mapOf(work(SOTA, WORK, []), work(OTHER, 'other-work', []));
    const csv = `${HEADER}\n${ROW_AMBIGUOUS}\n${WORK},${SOTA},Hulu,flatrate,high,,`;
    const preview = buildImportPreview(rows(csv), map, false);
    return { map, preview, held: preview.previewRows.find((r) => r.action === 'suspected_channel')! };
  };

  it('保留でない行・存在しない行番号への承認は拒否', () => {
    const { preview } = setup();
    const hulu = preview.previewRows.find((r) => r.vodService === 'Hulu')!;
    expect(validateApprovals(preview.previewRows, [approvalFor(hulu)]).ok).toBe(false);
    expect(validateApprovals(preview.previewRows, [approvalFor({ rowNum: 99, workId: WORK, personName: SOTA, vodService: 'Prime Video' })]).ok).toBe(false);
  });

  it('行内容（人物・作品・サービス）を書き換えた承認は拒否', () => {
    const { preview, held } = setup();
    expect(validateApprovals(preview.previewRows, [{ ...approvalFor(held), personName: OTHER }]).ok).toBe(false);
    expect(validateApprovals(preview.previewRows, [{ ...approvalFor(held), workId: 'other-work' }]).ok).toBe(false);
    expect(validateApprovals(preview.previewRows, [{ ...approvalFor(held), vodService: 'Netflix' }]).ok).toBe(false);
  });

  it('URL・理由の欠落、不正なURL、重複承認、配列以外は拒否', () => {
    const { preview, held } = setup();
    for (const bad of [
      [approvalFor(held, { officialUrl: '' })],
      [approvalFor(held, { reason: '' })],
      [approvalFor(held, { reason: 'ok' })],
      [approvalFor(held, { officialUrl: 'javascript:alert(1)' })],
      [approvalFor(held, { officialUrl: 'not a url' })],
      [approvalFor(held), approvalFor(held)],
      [{ ...approvalFor(held), rowNum: String(held.rowNum) }],
      'all',
      { rowNum: held.rowNum },
    ]) {
      expect(validateApprovals(preview.previewRows, bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('承認で種別や note は変えられない（CSV の値と flatrate で保存）', () => {
    const { preview, map, held } = setup();
    const plan = save(preview, [{ ...approvalFor(held), type: 'free', note: '改ざん', availabilityType: 'free' }], map);
    const prime = providersOf(plan, SOTA, WORK).find((p) => p.providerName === 'Prime Video')!;
    expect(prime.type).toBe('flatrate');
    expect(prime.note).toBe('プライム会員特典対象。Prime Videoチャンネルでも配信');
  });

  it('プレビュー指紋は行内容・DB状態・モードが変わると変わる', () => {
    const map = mapOf(work(SOTA, WORK, []));
    const base = buildImportPreview(rows(`${HEADER}\n${ROW_AMBIGUOUS}`), map, false).fingerprint;
    expect(buildImportPreview(rows(`${HEADER}\n${ROW_AMBIGUOUS}`), map, false).fingerprint).toBe(base);
    expect(buildImportPreview(rows(`${HEADER}\n${ROW_AMBIGUOUS}`), map, true).fingerprint).not.toBe(base);
    expect(buildImportPreview(rows(`${HEADER}\n${ROW_OK_NEGATED}`), map, false).fingerprint).not.toBe(base);
    const changedDb = mapOf(work(SOTA, WORK, [prov({})]));
    expect(buildImportPreview(rows(`${HEADER}\n${ROW_AMBIGUOUS}`), changedDb, false).fingerprint).not.toBe(base);
  });
});

describe('8. 追加/更新モードも正常に動作する', () => {
  it('追加・上書・スキップ・無視・エラー・unknown を従来どおり処理し、削除はしない', () => {
    const map = mapOf(work(SOTA, WORK, [
      prov({ providerName: 'Hulu', providerId: 15 }),
      prov({ providerName: 'U-NEXT', providerId: 97, source: 'tmdb_watch_provider' }),
      prov({ providerName: 'Netflix', providerId: 8 }),
    ]));
    const csv = [
      HEADER,
      `${WORK},${SOTA},Hulu,flatrate,high,,更新`,
      `${WORK},${SOTA},U-NEXT,flatrate,high,,`,
      `${WORK},${SOTA},Lemino,unknown,low,,`,
      `${WORK},${SOTA},Lemino,unknown,low,,`,
      `${WORK},${SOTA},,flatrate,high,,`,
      `,${SOTA},Hulu,flatrate,high,,`,
    ].join('\n');
    const preview = buildImportPreview(rows(csv), map, false);
    expect(preview.previewRows.map((r) => r.action)).toEqual(['update', 'skip', 'add', 'ignore', 'ignore', 'error']);
    expect(preview.deleteCount).toBe(0);
    const plan = save(preview, [], map);
    expect(plan.deleteBlockedReason).toBeNull(); // 追加/更新モードでは削除判定自体を行わない
    const saved = providersOf(plan, SOTA, WORK);
    expect(saved.find((p) => p.providerName === 'Lemino')?.type).toBe('unknown');
    expect(saved.find((p) => p.providerName === 'Hulu')?.note).toBe('更新');
    expect(saved.find((p) => p.providerName === 'Netflix')).toBeTruthy(); // CSVに無くても削除しない
    expect(saved.filter((p) => p.providerName === 'U-NEXT')).toHaveLength(1);
  });
});
