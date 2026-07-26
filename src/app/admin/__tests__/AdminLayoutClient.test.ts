import { describe, it, expect } from 'vitest';
import { isNavItemActive } from '../AdminLayoutClient';

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
});
