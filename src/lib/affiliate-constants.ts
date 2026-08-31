// アフィリエイト機能の定数（DBアクセスなし）。
// 'use client' コンポーネントから安全にimportできるよう、DBを触る src/lib/affiliate-store.ts
// とは意図的にファイルを分離している（src/lib/__tests__/client-server-boundary.test.ts が
// 'use client' ファイルから src/db/client.ts 等への到達を検知して落とすため）。

// 掲載箇所の初期候補（新しい掲載箇所を増やす場合はここに追記するだけでよい。
// 未知の slotKey が管理画面から渡された場合も保存自体は妨げない）。
export const KNOWN_SLOT_KEYS = ['work_provider', 'vod_hero', 'vod_mid', 'vod_bottom', 'person_vod'] as const;
