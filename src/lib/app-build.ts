// 配信中の版（Vercel のコミット）。管理画面を開いたままデプロイされたとき、画面のコードが古いことに気づけるようにする。
// ローカル（Vercel 以外）は null（比べない）。
export function currentAppBuild(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA || null;
}
