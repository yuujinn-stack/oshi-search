import 'server-only';
import { buildInstagramPost, type BuildPostResult } from './build-post';
import { buildInstagramPostWorksOnly } from './build-post-works-only';
import { buildInstagramPostWorksPicks } from './build-post-works-picks';
import { buildInstagramPostVodCompare } from './build-post-vod-compare';

export type TemplateBuilder = (personName: string) => Promise<BuildPostResult>;

/**
 * テンプレートID→生成関数の対応表。src/lib/instagram-templates.ts のIDと1対1に対応する。
 * 新しいテンプレートを追加する際は、ここに1行追加するだけでよい
 * （呼び出し側にif文を増やす必要はない）。
 */
export const TEMPLATE_BUILDERS: Record<string, TemplateBuilder> = {
  'default-person': buildInstagramPost,
  'works-only': buildInstagramPostWorksOnly,
  'works-picks': buildInstagramPostWorksPicks,
  'vod-compare': buildInstagramPostVodCompare,
};
