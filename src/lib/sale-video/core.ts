// 期間限定セールのリール動画: いまの日時で使うセールと開催状態を決める（純粋関数・'use client' 可）。
// 日時はトップの特設コーナーと同じ SALE_CORNERS を使い、開催状態の判定も同じ関数（salePhaseAt）を使う。

import { SALE_CORNERS, type SaleCornerConfig } from '@/lib/sale-corner/config';
import { salePhaseAt, toSaleCorner, upcomingLabel } from '@/lib/sale-corner/core';
import { SALE_VIDEO_CONFIGS, type SaleVideoConfig, type SaleVideoPhase } from './config';

/** 動画に渡すセールの情報（ジョブの template_input に保存する。Worker が生成の直前にも終了・開催状態を確かめる） */
export interface SaleVideoState {
  id: string;
  name: string;
  phase: SaleVideoPhase;
  /** +09:00 付きの ISO 8601（SALE_CORNERS の値そのまま） */
  startsAt: string;
  endsAt: string;
  /** 冒頭の帯（開催前「楽天ブラックフライデー 11月19日20時スタート」/ 開催中「楽天ブラックフライデー開催中」） */
  badge: string;
  prLabel: string;
}

export interface ActiveSaleVideo {
  config: SaleVideoConfig;
  state: SaleVideoState;
}

/**
 * いまの日時で使うセール（開催中 → 開始の早い順で1件）。告知期間外・終了後・設定の不備（日時・公式URL）は null
 * （トップの特設コーナーと同じ判定。どちらかだけが出る状態を作らない）
 */
export function pickSaleVideo(nowMs: number, videos: SaleVideoConfig[] = SALE_VIDEO_CONFIGS, corners: SaleCornerConfig[] = SALE_CORNERS): ActiveSaleVideo | null {
  const found: Array<ActiveSaleVideo & { startsMs: number }> = [];
  for (const v of videos) {
    const raw = corners.find((c) => c.id === v.saleCornerId);
    const corner = raw ? toSaleCorner(raw) : null;
    if (!raw || !corner) continue;
    const phase = salePhaseAt(corner, nowMs);
    if (!phase) continue;
    const badge = phase === 'active' ? v.activeBadge : `${v.name} ${upcomingLabel(corner)}`;
    found.push({ config: v, startsMs: corner.startsAt, state: { id: raw.id, name: v.name, phase, startsAt: raw.startsAt, endsAt: raw.endsAt, badge, prLabel: v.prLabel } });
  }
  found.sort((a, b) => (a.state.phase === b.state.phase ? a.startsMs - b.startsMs : a.state.phase === 'active' ? -1 : 1));
  if (found.length === 0) return null;
  const { config, state } = found[0];
  return { config, state };
}

export function saleVideoConfigOf(id: string, videos: SaleVideoConfig[] = SALE_VIDEO_CONFIGS): SaleVideoConfig | null {
  return videos.find((v) => v.saleCornerId === id) ?? null;
}

/**
 * 保存済みのセールの情報が、いまも同じ開催状態か（終了・開催状態の変化を検出する。ジョブ作成時・Worker の生成前に使う）。
 * ok=false のときは理由（終了した / 開催が始まったため「始まります」の台本は使えない）
 */
export function checkSaleVideoState(state: Pick<SaleVideoState, 'phase' | 'startsAt' | 'endsAt' | 'name'>, nowMs: number): { ok: true } | { ok: false; reason: string } {
  const startsAt = Date.parse(state.startsAt);
  const endsAt = Date.parse(state.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return { ok: false, reason: 'セールの日時が不正です。' };
  if (nowMs >= endsAt) return { ok: false, reason: `${state.name}は終了したため、この動画は作成できません。` };
  const now: SaleVideoPhase = nowMs >= startsAt ? 'active' : 'upcoming';
  if (now !== state.phase) return { ok: false, reason: `${state.name}の開催状態が変わりました（${state.phase === 'upcoming' ? '開催前' : '開催中'} → ${now === 'upcoming' ? '開催前' : '開催中'}）。管理画面で台本を作り直してください。` };
  return { ok: true };
}
