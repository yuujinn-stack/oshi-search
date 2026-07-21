// 復旧実行の安全ガード関数
// サーバーサイドの実行可否判定と、クライアントサイドのUI制御を統一する

// ── サーバーサイド: 実行環境チェック ────────────────────────────────────────
//
// 実行可能条件:
//   VERCEL_ENV=production  かつ  DATA_RECOVERY_EXECUTION_ENABLED=true
//
// Preview / development / local / フラグ未設定はすべて 403

export function isRecoveryExecutionAllowed(): boolean {
  return (
    process.env.VERCEL_ENV === 'production' &&
    process.env.DATA_RECOVERY_EXECUTION_ENABLED === 'true'
  );
}

export function getRecoveryBlockReason(): string | null {
  const env = process.env.VERCEL_ENV;
  if (env === 'preview') {
    return 'Preview 環境では復旧実行は禁止されています（dry-run のみ利用可能）';
  }
  if (env === 'development') {
    return '開発環境では復旧実行は禁止されています';
  }
  if (env !== 'production') {
    return '本番環境 (VERCEL_ENV=production) 以外では実行できません';
  }
  if (process.env.DATA_RECOVERY_EXECUTION_ENABLED !== 'true') {
    return 'DATA_RECOVERY_EXECUTION_ENABLED=true が設定されていないため実行できません';
  }
  return null;
}

// ── クライアントサイド: 実行ゲート純粋関数 ───────────────────────────────────
// これらは UI コンポーネントの「実行ボタン活性化条件」として使用する。
// recoveryEnabled は page.tsx (Server Component) が isRecoveryExecutionAllowed() で計算し、
// props として渡す値。

export interface WorkRecoveryExecParams {
  confirmInput:    string;
  reason:          string;
  selectedCount:   number;
  recoveryEnabled: boolean;
}

export function canExecuteWorkRecovery(params: WorkRecoveryExecParams): boolean {
  return (
    params.confirmInput === 'RECOVER' &&
    params.reason.trim().length > 0 &&
    params.selectedCount > 0 &&
    params.recoveryEnabled
  );
}

export interface ProductRecoveryExecParams {
  confirmInput:    string;
  reason:          string;
  idempotencyKey:  string;
  recoverableCount: number;
  recoveryEnabled: boolean;
}

export function canExecuteProductRecovery(params: ProductRecoveryExecParams): boolean {
  return (
    params.confirmInput === 'RECOVER_PRODUCTS' &&
    params.reason.trim().length > 0 &&
    params.idempotencyKey.trim().length > 0 &&
    params.recoverableCount > 0 &&
    params.recoveryEnabled
  );
}
