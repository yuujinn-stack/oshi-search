// 本番反映の前に、動画生成ジョブの待機中・生成中の件数と Worker の生存報告を確認する（読み取りのみ。SELECT だけで更新しない）。
// 使い方: npx tsx --env-file=.env.local scripts/video-jobs/check-active-jobs.ts
// queued（待機中）・processing（生成中）が0件で、Worker の最終報告が新しいことを確認してから、Worker の再起動・コードの取り込みを行う。
import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL がありません（--env-file=.env.local を付けてください）');
  const sql = neon(url);
  const counts = await sql`SELECT status, count(*)::int AS n FROM video_generation_jobs WHERE status IN ('queued', 'processing') GROUP BY status`;
  const active = await sql`SELECT id, status, template_id, person_name, narration_mode, created_at, started_at, progress_label FROM video_generation_jobs WHERE status IN ('queued', 'processing') ORDER BY created_at`;
  const workers = await sql`SELECT * FROM video_workers ORDER BY last_seen_at DESC NULLS LAST LIMIT 3`.catch(() => []);
  const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  console.log(`待機中(queued): ${n('queued')}件 / 生成中(processing): ${n('processing')}件`);
  for (const j of active) console.log(`  ${j.status} ${String(j.id).slice(0, 8)} ${j.template_id} ${j.person_name} ${j.narration_mode} 作成 ${new Date(j.created_at).toISOString()} ${j.progress_label ?? ''}`);
  for (const w of workers as Array<Record<string, unknown>>) {
    const seen = w.last_seen_at ? new Date(String(w.last_seen_at)) : null;
    console.log(`Worker ${String(w.id ?? w.worker_id ?? '').slice(0, 24)} 最終報告 ${seen ? `${seen.toISOString()}（${Math.round((Date.now() - seen.getTime()) / 1000)}秒前）` : '不明'}`);
  }
  console.log(n('queued') + n('processing') === 0 ? 'OK: 処理中のジョブはありません' : '注意: 処理中のジョブがあります。完了するまで反映・再起動を待ってください');
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
