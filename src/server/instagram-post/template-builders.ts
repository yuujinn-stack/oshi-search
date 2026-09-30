import 'server-only';
import { buildInstagramPost, type BuildPostResult } from './build-post';
import { buildInstagramPostWorksOnly } from './build-post-works-only';
import { buildInstagramPostWorksPicks } from './build-post-works-picks';
import { buildInstagramPostVodCompare } from './build-post-vod-compare';
import { SITE_UI_BUILDERS } from './site-ui/builders';
import { H_TEMPLATE_ID } from '@/lib/instagram-templates';

export type TemplateBuilder = (personName: string) => Promise<BuildPostResult>;

/**
 * テンプレートID→生成関数の対応表。src/lib/instagram-templates.ts の SCHEDULABLE_TEMPLATES のIDと1対1に対応する。
 * 新しいテンプレートを追加する際は、ここに1行追加するだけでよい
 * （呼び出し側にif文を増やす必要はない）。
 */
export const TEMPLATE_BUILDERS: Record<string, TemplateBuilder> = {
  'default-person': buildInstagramPost,
  'works-only': buildInstagramPostWorksOnly,
  'works-picks': buildInstagramPostWorksPicks,
  'vod-compare': buildInstagramPostVodCompare,
  // H「観るもの・買うもの、まとめて」（予約画面で明示的に選んだ場合のみ。自動選択の候補には入らない）
  [H_TEMPLATE_ID]: SITE_UI_BUILDERS[H_TEMPLATE_ID],
};
