import { describe, it, expect } from 'vitest';
import { isNavItemActive, NAV_ITEMS } from '../AdminLayoutClient';

describe('isNavItemActive — 管理ナビの現在位置判定', () => {
  it('完全一致でアクティブになる（/admin/work-dedup）', () => {
    expect(isNavItemActive('/admin/work-dedup', '/admin/work-dedup')).toBe(true);
  });

  it('サブパスでもアクティブになる', () => {
    expect(isNavItemActive('/admin/work-dedup/detail', '/admin/work-dedup')).toBe(true);
  });

  it('他のページではアクティブにならない', () => {
    expect(isNavItemActive('/admin/work-check', '/admin/work-dedup')).toBe(false);
  });

  it('前方一致だが別セグメントの場合は誤ってアクティブにならない', () => {
    // '/admin/work-dedup-extra' は '/admin/work-dedup' の前方一致だが別ページなので非アクティブ
    expect(isNavItemActive('/admin/work-dedup-extra', '/admin/work-dedup')).toBe(false);
  });

  it('/admin/vod-recheck も既存と同じ判定方法でアクティブになる', () => {
    expect(isNavItemActive('/admin/vod-recheck', '/admin/vod-recheck')).toBe(true);
    expect(isNavItemActive('/admin/vod-recheck/anything', '/admin/vod-recheck')).toBe(true);
    expect(isNavItemActive('/admin/work-check', '/admin/vod-recheck')).toBe(false);
  });
});

describe('NAV_ITEMS — 共通管理ナビゲーション', () => {
  it('「VOD再確認」(/admin/vod-recheck) が「配信サービス」の直後に配置されている', () => {
    const providersIdx = NAV_ITEMS.findIndex((i) => i.href === '/admin/providers');
    const vodRecheckIdx = NAV_ITEMS.findIndex((i) => i.href === '/admin/vod-recheck');
    expect(providersIdx).toBeGreaterThanOrEqual(0);
    expect(vodRecheckIdx).toBe(providersIdx + 1);
    expect(NAV_ITEMS[vodRecheckIdx].label).toBe('VOD再確認');
  });

  it('既存の「配信サービス」(/admin/providers) は変更されていない', () => {
    const providers = NAV_ITEMS.find((i) => i.href === '/admin/providers');
    expect(providers?.label).toBe('配信サービス');
  });

  it('VOD再確認は重複なく1件だけ存在する', () => {
    const matches = NAV_ITEMS.filter((i) => i.href === '/admin/vod-recheck');
    expect(matches.length).toBe(1);
  });
});
