import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveRunLimits } from '../../../scripts/price-refresh/limits';

// 価格の分割自動更新のワークフロー（.github/workflows/price-refresh.yml）の定期実行の設定。
// 時刻・緊急停止の変数・1回の上限が意図せず変わらないことを確かめる（YAML の文字列を読むだけ）。
const WORKFLOW = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/price-refresh.yml'), 'utf8');
const activeLines = WORKFLOW.split('\n').filter((l) => !l.trim().startsWith('#'));
const active = activeLines.join('\n');

/** env の「schedule のときの既定値」（`github.event_name == 'workflow_dispatch' && inputs.x || '既定'`） */
function scheduleDefault(name: string): string | undefined {
  const line = activeLines.find((l) => l.trim().startsWith(`${name}:`));
  return line?.match(/\|\|\s*'([^']*)'\s*}}\s*$/)?.[1];
}

describe('価格の分割自動更新の定期実行（ワークフロー）', () => {
  it('定期実行は1日4回：UTC 1,7,13,19時の37分（JST 10:37・16:37・22:37・4:37）', () => {
    const crons = [...active.matchAll(/^\s*-\s*cron:\s*'([^']+)'/gm)].map((m) => m[1]);
    expect(crons).toEqual(['37 1,7,13,19 * * *']);
    const hoursJst = crons[0].split(' ')[1].split(',').map((h) => (Number(h) + 9) % 24);
    expect(hoursJst).toEqual([10, 16, 22, 4]);
  });

  it('新商品の発見（/api/cron/refresh、UTC 3時台）と同じ時間帯に始めない', () => {
    const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../vercel.json'), 'utf8')) as { crons: { path: string; schedule: string }[] };
    const discoveryHours = vercel.crons.filter((c) => c.path === '/api/cron/refresh').map((c) => Number(c.schedule.split(' ')[1]));
    expect(discoveryHours).toEqual([3]);
    const hours = active.match(/cron:\s*'37 ([\d,]+) \* \* \*'/)![1].split(',').map(Number);
    for (const h of hours) expect(discoveryHours).not.toContain(h);
  });

  it('定期実行はリポジトリ変数 PRICE_REFRESH_ENABLED が true のときだけ（緊急停止のスイッチ）。全件の手動実行も同じ変数が必要', () => {
    expect(active).toMatch(/if:\s*github\.event_name == 'workflow_dispatch' \|\| vars\.PRICE_REFRESH_ENABLED == 'true'/);
    expect(active).toMatch(/inputs\.mode == 'full' && vars\.PRICE_REFRESH_ENABLED != 'true'/);
  });

  it('定期実行の1回の上限：人物30人・楽天API 400回・最短更新間隔3日・作業時間20分・コード指定60件', () => {
    const env = {
      PRICE_REFRESH_MAX_PERSONS: scheduleDefault('PRICE_REFRESH_MAX_PERSONS'),
      PRICE_REFRESH_MAX_API_CALLS: scheduleDefault('PRICE_REFRESH_MAX_API_CALLS'),
      PRICE_REFRESH_MIN_INTERVAL_DAYS: scheduleDefault('PRICE_REFRESH_MIN_INTERVAL_DAYS'),
    };
    expect(env).toEqual({ PRICE_REFRESH_MAX_PERSONS: '30', PRICE_REFRESH_MAX_API_CALLS: '400', PRICE_REFRESH_MIN_INTERVAL_DAYS: '3' });
    expect(scheduleDefault('PRICE_REFRESH_BUDGET_MIN')).toBe('20');
    expect(scheduleDefault('PRICE_REFRESH_LOOKUP_PER_PERSON')).toBe('60');
    // 定期実行では少人数の通常実行・dry-run・人物の指定にならない（すべて workflow_dispatch のときだけ）
    for (const name of ['PRICE_REFRESH_LIMITED', 'PRICE_REFRESH_DRY_RUN', 'PRICE_REFRESH_PERSONS', 'PRICE_REFRESH_REQUIRE_PERSONS']) {
      expect(activeLines.find((l) => l.trim().startsWith(`${name}:`))).toMatch(/github\.event_name == 'workflow_dispatch' &&/);
    }
    // 実行時に使われる値（scripts/price-refresh/limits.ts）
    expect(resolveRunLimits(env)).toMatchObject({ maxPersons: 30, maxApiCalls: 400, minIntervalDays: 3, limited: false });
  });

  it('同時に2つ動かさない（実行中のものを取り消さず、次は待つ）・ジョブの時間の上限・OpenAI の鍵を渡さない', () => {
    expect(active).toMatch(/concurrency:\s*\n\s*group: price-refresh\s*\n\s*cancel-in-progress: false/);
    expect(active).toMatch(/timeout-minutes: 45/);
    expect(active).not.toMatch(/OPENAI/);
    expect(active).toMatch(/permissions:\s*\n\s*contents: read/);
  });
});
