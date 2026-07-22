/**
 * 作品重複統合（apply）のビジネスロジック
 *
 * - applyPreview: 変更内容の事前確認（読み取り専用）
 * - executeApply: 実際の統合（DBトランザクション）
 *   ※ WORK_DEDUP_APPLY_ENABLED=true のときのみ呼び出せる
 */

import { db, neonSql } from '@/db/client';
import {
  works as worksTable,
  workDedupReviews as reviewsTable,
  workAliases as workAliasesTable,
  workMergeLogs as workMergeLogsTable,
} from '@/db/schema';
import { inArray, eq } from 'drizzle-orm';
import type { VodProvider } from '@/types/vod';
import { normalizeProviderName } from '@/lib/vod-dedup';
import { getRedis } from '@/lib/redis';
import { isGroupStale } from '@/lib/work-dedup-review';
import { ALGORITHM_VERSION } from '@/lib/work-dedup';

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface PersonLinkChange {
  personName: string;
  duplicateWorkId: string;
  canonicalWorkId: string;
  action: 'move' | 'remove'; // move=新規追加, remove=canonical側が既存で重複
  duplicateRoleName: string | null;
  canonicalRoleName: string | null;
  mergedRoleName: string | null; // move時: canonical既存+dupeから最良を選択
}

export interface ApplyPreview {
  canonicalWorkId: string;
  duplicateWorkIds: string[];
  personLinkChanges: PersonLinkChange[];
  vodProvidersMergedCount: number; // canonical に追加される提供元数
  worksToDeactivate: Array<{ workId: string; personName: string; currentStatus: string }>;
  aliasesToCreate: string[]; // duplicateWorkId のリスト
  alreadyApplied: boolean;
  appliedAt?: string;
  isStale: boolean;
  currentWorkIds: string[]; // 現在検出されている workId リスト
}

export interface ApplyResult {
  success: boolean;
  personLinksMoved: number;
  personLinksRemoved: number;
  vodProvidersMerged: number;
  aliasesCreated: number;
  redisClickMoved: number;
  redisKeysDeleted: number;
  redisError: string | null;
}

// ─── VODマージ ───────────────────────────────────────────────────────────────

/**
 * canonicalのVODプロバイダーにduplicateのVODをマージする（純粋関数）。
 * - 同じ normalizeProviderName + type の組み合わせは canonical を優先（duplicate を捨てる）
 * - hidden なプロバイダーは引き継がない（dupeの hidden 行はスキップ）
 */
export function mergeVodProviders(
  canonicalProviders: VodProvider[],
  duplicateProviders: VodProvider[],
): VodProvider[] {
  // canonical のキーセットを作成（normalizedName + type）
  const canonicalKeys = new Set(
    canonicalProviders.map((p) => `${normalizeProviderName(p.providerName)}::${p.type}`),
  );

  // dupeのうち hidden でなく canonical に重複しないものを追加
  const toAdd = duplicateProviders.filter((p) => {
    if (p.hidden) return false;
    const key = `${normalizeProviderName(p.providerName)}::${p.type}`;
    return !canonicalKeys.has(key);
  });

  return [...canonicalProviders, ...toAdd];
}

// ─── バリデーション ───────────────────────────────────────────────────────────

export function validateApplyRequest(body: unknown):
  | { ok: true; input: { confirmationText: string; expectedCanonicalWorkId: string; expectedCandidateWorkIds: string[]; expectedUpdatedAt: string } }
  | { ok: false; error: { code: string; message: string } } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: { code: 'INVALID_BODY', message: 'リクエストボディが不正です' } };
  }

  const b = body as Record<string, unknown>;

  // confirmationText チェック
  if (b.confirmationText !== '統合を実行') {
    return {
      ok: false,
      error: { code: 'INVALID_CONFIRMATION_TEXT', message: '確認テキストが不正です。「統合を実行」と入力してください' },
    };
  }

  // expectedCanonicalWorkId チェック
  if (typeof b.expectedCanonicalWorkId !== 'string' || b.expectedCanonicalWorkId.trim() === '') {
    return {
      ok: false,
      error: { code: 'MISSING_CANONICAL_WORK_ID', message: 'expectedCanonicalWorkId は必須です' },
    };
  }

  // expectedCandidateWorkIds チェック（2件以上の string[]）
  if (
    !Array.isArray(b.expectedCandidateWorkIds) ||
    b.expectedCandidateWorkIds.length < 2 ||
    !b.expectedCandidateWorkIds.every((v) => typeof v === 'string')
  ) {
    return {
      ok: false,
      error: { code: 'INVALID_CANDIDATE_WORK_IDS', message: 'expectedCandidateWorkIds は2件以上の文字列配列でなければなりません' },
    };
  }

  // expectedUpdatedAt チェック
  if (typeof b.expectedUpdatedAt !== 'string' || b.expectedUpdatedAt.trim() === '') {
    return {
      ok: false,
      error: { code: 'MISSING_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt は必須です' },
    };
  }

  return {
    ok: true,
    input: {
      confirmationText: b.confirmationText,
      expectedCanonicalWorkId: b.expectedCanonicalWorkId.trim(),
      expectedCandidateWorkIds: b.expectedCandidateWorkIds as string[],
      expectedUpdatedAt: b.expectedUpdatedAt.trim(),
    },
  };
}

// ─── プレビュー構築 ───────────────────────────────────────────────────────────

export async function buildApplyPreview(
  groupKey: string,
  groupWorkIds: string[],
): Promise<
  | { ok: true; preview: ApplyPreview }
  | { ok: false; error: { code: string; message: string } }
> {
  try {
    // 1. work_dedup_reviews からレビュー行を取得
    const reviewRows = await db
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.candidateGroupKey, groupKey))
      .limit(1);

    const review = reviewRows[0] ?? null;

    if (!review || review.reviewStatus !== 'approved_duplicate' || !review.selectedCanonicalWorkId) {
      return {
        ok: false,
        error: {
          code: 'REVIEW_NOT_APPROVED',
          message: 'このグループは approved_duplicate かつ canonical が選定されていません',
        },
      };
    }

    const canonicalWorkId = review.selectedCanonicalWorkId;
    const duplicateWorkIds = groupWorkIds.filter((id) => id !== canonicalWorkId);

    if (duplicateWorkIds.length === 0) {
      return {
        ok: false,
        error: {
          code: 'NO_DUPLICATES',
          message: '重複候補が存在しません',
        },
      };
    }

    // stale 判定
    const reviewWorkIds = review.candidateWorkIds as string[];
    const isStale = isGroupStale(reviewWorkIds, review.algorithmVersion, groupWorkIds);

    // already applied 判定
    const alreadyApplied = review.appliedAt != null;

    // 2. works テーブルから全関連行を取得
    const allWorkIds = [canonicalWorkId, ...duplicateWorkIds];
    const workRows = await db
      .select({
        id:        worksTable.id,
        personName: worksTable.personName,
        roleName:   worksTable.roleName,
        status:     worksTable.status,
        vodData:    worksTable.vodData,
      })
      .from(worksTable)
      .where(inArray(worksTable.id, allWorkIds));

    // work_aliases で既存エントリを確認
    const aliasRows = await db
      .select({ aliasWorkId: workAliasesTable.aliasWorkId })
      .from(workAliasesTable)
      .where(inArray(workAliasesTable.aliasWorkId, duplicateWorkIds));
    const existingAliasIds = new Set(aliasRows.map((r) => r.aliasWorkId));

    // canonical 側の personName セット
    const canonicalRows = workRows.filter((r) => r.id === canonicalWorkId);
    const canonicalPersonSet = new Map<string, string | null>(
      canonicalRows.map((r) => [r.personName, r.roleName ?? null]),
    );

    // 3. PersonLinkChange を計算
    const personLinkChanges: PersonLinkChange[] = [];

    for (const dupeId of duplicateWorkIds) {
      const dupeRows = workRows.filter((r) => r.id === dupeId);
      for (const row of dupeRows) {
        const pn = row.personName;
        const canonicalRole = canonicalPersonSet.get(pn) ?? null;
        const dupeRole = row.roleName ?? null;

        if (canonicalPersonSet.has(pn)) {
          // canonical に既存 → remove
          personLinkChanges.push({
            personName: pn,
            duplicateWorkId: dupeId,
            canonicalWorkId,
            action: 'remove',
            duplicateRoleName: dupeRole,
            canonicalRoleName: canonicalRole,
            mergedRoleName: null,
          });
        } else {
          // canonical に未存在 → move
          // mergedRoleName: canonical 側なし → dupe の roleName を使う
          personLinkChanges.push({
            personName: pn,
            duplicateWorkId: dupeId,
            canonicalWorkId,
            action: 'move',
            duplicateRoleName: dupeRole,
            canonicalRoleName: null,
            mergedRoleName: dupeRole,
          });
        }
      }
    }

    // 4. VOD統合後の増加数を計算
    const canonicalVodProviders = (() => {
      const row = canonicalRows[0];
      if (!row) return [];
      const vd = row.vodData as Record<string, unknown> | null;
      return (vd?.vodProviders as VodProvider[] | undefined) ?? [];
    })();

    let vodMergedCount = 0;
    for (const dupeId of duplicateWorkIds) {
      const dupeRow = workRows.find((r) => r.id === dupeId);
      if (!dupeRow) continue;
      const vd = dupeRow.vodData as Record<string, unknown> | null;
      const dupeProviders = (vd?.vodProviders as VodProvider[] | undefined) ?? [];
      const merged = mergeVodProviders(canonicalVodProviders, dupeProviders);
      vodMergedCount += merged.length - canonicalVodProviders.length;
    }

    // 5. worksToDeactivate
    const worksToDeactivate: ApplyPreview['worksToDeactivate'] = [];
    for (const dupeId of duplicateWorkIds) {
      const dupeRows = workRows.filter((r) => r.id === dupeId);
      for (const row of dupeRows) {
        worksToDeactivate.push({
          workId: dupeId,
          personName: row.personName,
          currentStatus: row.status,
        });
      }
    }

    // 6. aliasesToCreate（まだ alias がない duplicateWorkId のみ）
    const aliasesToCreate = duplicateWorkIds.filter((id) => !existingAliasIds.has(id));

    return {
      ok: true,
      preview: {
        canonicalWorkId,
        duplicateWorkIds,
        personLinkChanges,
        vodProvidersMergedCount: Math.max(0, vodMergedCount),
        worksToDeactivate,
        aliasesToCreate,
        alreadyApplied,
        appliedAt: review.appliedAt?.toISOString(),
        isStale,
        currentWorkIds: groupWorkIds,
      },
    };
  } catch (err) {
    console.error('[buildApplyPreview] error', err);
    return {
      ok: false,
      error: {
        code: 'PREVIEW_BUILD_FAILED',
        message: 'プレビューの構築に失敗しました',
      },
    };
  }
}

// ─── Redis後処理（best-effort） ───────────────────────────────────────────────

async function syncRedisAfterApply(
  canonicalWorkId: string,
  duplicateWorkIds: string[],
): Promise<{ clickMoved: number; keysDeleted: number; error: string | null }> {
  const redis = getRedis();
  if (!redis) {
    return { clickMoved: 0, keysDeleted: 0, error: 'Redis未設定' };
  }

  let clickMoved = 0;
  let keysDeleted = 0;
  try {
    for (const dupeId of duplicateWorkIds) {
      const clickKey = `work:click:${dupeId}`;
      const metaKey  = `work:meta:${dupeId}`;

      // click カウントを canonical へ移動
      const clickVal = await redis.get<string>(clickKey);
      const clickNum = clickVal ? parseInt(clickVal, 10) : 0;
      if (clickNum > 0) {
        await redis.incrby(`work:click:${canonicalWorkId}`, clickNum);
        clickMoved += clickNum;
      }

      // dupe の meta と click を削除
      await redis.del(metaKey);
      await redis.del(clickKey);
      keysDeleted += 2;
    }
    return { clickMoved, keysDeleted, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { clickMoved, keysDeleted, error: msg };
  }
}

// ─── 統合実行 ─────────────────────────────────────────────────────────────────

export async function executeApply(params: {
  groupKey: string;
  canonicalWorkId: string;
  duplicateWorkIds: string[];
  expectedUpdatedAt: string;
  appliedBy: string | null;
}): Promise<ApplyResult> {
  const { groupKey, canonicalWorkId, duplicateWorkIds, expectedUpdatedAt, appliedBy } = params;

  // 事前にworksのデータを取得（トランザクション外でのJSロジック用）
  const allWorkIds = [canonicalWorkId, ...duplicateWorkIds];
  const workRows = await db
    .select({
      id:         worksTable.id,
      personName: worksTable.personName,
      roleName:   worksTable.roleName,
      vodData:    worksTable.vodData,
    })
    .from(worksTable)
    .where(inArray(worksTable.id, allWorkIds));

  // canonical側のVODを取得
  const canonicalVodRow = workRows.find((r) => r.id === canonicalWorkId);
  const canonicalVodProviders: VodProvider[] = (() => {
    if (!canonicalVodRow) return [];
    const vd = canonicalVodRow.vodData as Record<string, unknown> | null;
    return (vd?.vodProviders as VodProvider[] | undefined) ?? [];
  })();

  // dupeのVODをまとめてmerge
  let mergedProviders = [...canonicalVodProviders];
  let vodProvidersMergedCount = 0;
  for (const dupeId of duplicateWorkIds) {
    const dupeRow = workRows.find((r) => r.id === dupeId);
    if (!dupeRow) continue;
    const vd = dupeRow.vodData as Record<string, unknown> | null;
    const dupeProviders = (vd?.vodProviders as VodProvider[] | undefined) ?? [];
    const before = mergedProviders.length;
    mergedProviders = mergeVodProviders(mergedProviders, dupeProviders);
    vodProvidersMergedCount += mergedProviders.length - before;
  }

  // canonical側のpersonNameセット
  const canonicalPersonNames = new Set(
    workRows.filter((r) => r.id === canonicalWorkId).map((r) => r.personName),
  );

  // 移動・重複除去の集計
  let personLinksMoved = 0;
  let personLinksRemoved = 0;

  for (const dupeId of duplicateWorkIds) {
    const dupeRows = workRows.filter((r) => r.id === dupeId);
    for (const row of dupeRows) {
      if (canonicalPersonNames.has(row.personName)) {
        personLinksRemoved++;
      } else {
        personLinksMoved++;
      }
    }
  }

  const mergedVodJson = JSON.stringify(mergedProviders);
  const appliedByStr = appliedBy ?? 'unknown';
  const appliedByEscaped = appliedByStr.replace(/'/g, "''");
  const groupKeyEscaped = groupKey.replace(/'/g, "''");
  const canonicalIdEscaped = canonicalWorkId.replace(/'/g, "''");

  // トランザクション内クエリを構築
  const txQueries: ReturnType<typeof neonSql>[] = [];

  // Step 0: ガードDOブロック（precondition check）
  txQueries.push(neonSql`
    DO $$
    DECLARE
      v_count integer;
    BEGIN
      SELECT COUNT(*) INTO v_count
      FROM work_dedup_reviews
      WHERE candidate_group_key = ${groupKey}
        AND review_status = 'approved_duplicate'
        AND selected_canonical_work_id = ${canonicalWorkId}
        AND applied_at IS NULL
        AND updated_at = ${expectedUpdatedAt}::timestamptz;

      IF v_count = 0 THEN
        RAISE EXCEPTION 'APPLY_PRECONDITION_FAILED' USING ERRCODE = 'P0001';
      END IF;
    END;
    $$
  `);

  // Step 1: 各dupeWorkIdについて人物リンク処理
  for (const dupeId of duplicateWorkIds) {
    // Step 1a: canonical側にない personName 行を INSERT（move）
    txQueries.push(neonSql`
      INSERT INTO works (
        id, person_name, title, original_title, normalized_title, type, tmdb_id,
        source, release_year, role_name, overview, poster_url, og_image_url, og_source_url,
        og_image_fetched_at, og_image_status, og_image_error, confidence_score,
        status, deleted, deleted_at, deleted_by, checked_at, ai_data, vod_data,
        created_at, updated_at
      )
      SELECT
        ${canonicalWorkId}, person_name, title, original_title, normalized_title, type, tmdb_id,
        source, release_year, role_name, overview, poster_url, og_image_url, og_source_url,
        og_image_fetched_at, og_image_status, og_image_error, confidence_score,
        status, deleted, deleted_at, deleted_by, checked_at, ai_data, vod_data,
        created_at, NOW()
      FROM works
      WHERE id = ${dupeId}
        AND person_name NOT IN (
          SELECT person_name FROM works WHERE id = ${canonicalWorkId}
        )
      ON CONFLICT DO NOTHING
    `);

    // Step 1b: canonical側に既に存在する personName の roleName をマージ
    // canonical の role_name が NULL の場合のみ dupe の role_name で補完
    txQueries.push(neonSql`
      UPDATE works
      SET
        role_name = COALESCE(
          role_name,
          (SELECT role_name FROM works w2 WHERE w2.id = ${dupeId} AND w2.person_name = works.person_name LIMIT 1)
        ),
        updated_at = NOW()
      WHERE id = ${canonicalWorkId}
        AND person_name IN (
          SELECT person_name FROM works WHERE id = ${dupeId}
        )
    `);

    // Step 1c: dupe行を論理削除
    txQueries.push(neonSql`
      UPDATE works
      SET
        status      = 'hidden',
        deleted     = true,
        deleted_at  = NOW(),
        deleted_by  = 'work_dedup_apply',
        updated_at  = NOW()
      WHERE id = ${dupeId}
    `);

    // Step 2: work_aliases へINSERT（冪等）
    txQueries.push(neonSql`
      INSERT INTO work_aliases (alias_work_id, canonical_work_id, merge_group_key, created_by, created_at)
      VALUES (${dupeId}, ${canonicalWorkId}, ${groupKey}, ${appliedBy}, NOW())
      ON CONFLICT (alias_work_id) DO NOTHING
    `);
  }

  // Step 3: canonical の vodData 更新
  txQueries.push(neonSql`
    UPDATE works
    SET
      vod_data   = jsonb_set(
        COALESCE(vod_data, '{}'::jsonb),
        '{vodProviders}',
        ${mergedVodJson}::jsonb,
        true
      ),
      updated_at = NOW()
    WHERE id = ${canonicalWorkId}
  `);

  // Step 4: work_dedup_reviews 更新
  const applyResultJson = JSON.stringify({
    personLinksMoved,
    personLinksRemoved,
    vodProvidersMerged: vodProvidersMergedCount,
    aliasesCreated: duplicateWorkIds.length,
  });
  txQueries.push(neonSql`
    UPDATE work_dedup_reviews
    SET
      applied_at                = NOW(),
      applied_by                = ${appliedBy},
      applied_canonical_work_id = ${canonicalWorkId},
      apply_result              = ${applyResultJson}::jsonb,
      updated_at                = NOW()
    WHERE candidate_group_key = ${groupKey}
  `);

  // Step 5: work_merge_logs INSERT
  txQueries.push(neonSql`
    INSERT INTO work_merge_logs (
      candidate_group_key, canonical_work_id, duplicate_work_ids,
      person_links_moved, person_links_removed, vod_providers_merged,
      aliases_created, redis_click_moved, redis_keys_deleted,
      redis_error, success, error_message, executed_by, executed_at
    ) VALUES (
      ${groupKey}, ${canonicalWorkId}, ${JSON.stringify(duplicateWorkIds)}::jsonb,
      ${personLinksMoved}, ${personLinksRemoved}, ${vodProvidersMergedCount},
      ${duplicateWorkIds.length}, 0, 0,
      NULL, true, NULL, ${appliedBy}, NOW()
    )
  `);

  // トランザクション実行
  try {
    await neonSql.transaction(txQueries);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[executeApply] transaction failed', err);

    // エラーログをDBに記録（best-effort）
    try {
      await db.insert(workMergeLogsTable).values({
        candidateGroupKey:  groupKey,
        canonicalWorkId,
        duplicateWorkIds,
        personLinksMoved:   0,
        personLinksRemoved: 0,
        vodProvidersMerged: 0,
        aliasesCreated:     0,
        redisClickMoved:    0,
        redisKeysDeleted:   0,
        redisError:         null,
        success:            false,
        errorMessage:       msg,
        executedBy:         appliedBy,
      });
    } catch { /* ignore */ }

    return {
      success: false,
      personLinksMoved: 0,
      personLinksRemoved: 0,
      vodProvidersMerged: 0,
      aliasesCreated: 0,
      redisClickMoved: 0,
      redisKeysDeleted: 0,
      redisError: null,
    };
  }

  // Redis後処理（best-effort）
  const redisResult = await syncRedisAfterApply(canonicalWorkId, duplicateWorkIds);

  // work_merge_logs を Redis 結果で更新（best-effort）
  try {
    await db
      .insert(workMergeLogsTable)
      .values({
        candidateGroupKey:  groupKey,
        canonicalWorkId,
        duplicateWorkIds,
        personLinksMoved,
        personLinksRemoved,
        vodProvidersMerged: vodProvidersMergedCount,
        aliasesCreated:     duplicateWorkIds.length,
        redisClickMoved:    redisResult.clickMoved,
        redisKeysDeleted:   redisResult.keysDeleted,
        redisError:         redisResult.error,
        success:            true,
        errorMessage:       null,
        executedBy:         appliedBy,
      });
  } catch (err) {
    console.warn('[executeApply] merge log insert failed', err);
  }

  return {
    success: true,
    personLinksMoved,
    personLinksRemoved,
    vodProvidersMerged: vodProvidersMergedCount,
    aliasesCreated: duplicateWorkIds.length,
    redisClickMoved: redisResult.clickMoved,
    redisKeysDeleted: redisResult.keysDeleted,
    redisError: redisResult.error,
  };
}

// ALGORITHM_VERSION を再エクスポート（外部でも参照できるように）
export { ALGORITHM_VERSION };
