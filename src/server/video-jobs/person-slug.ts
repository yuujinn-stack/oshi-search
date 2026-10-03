import { createHash } from 'node:crypto';

/**
 * 動画生成Workerへ渡す人物slug。推しサーチDBの人物にはローマ字slugが無いため、人物名から一意に決まる
 * 「p-」+ sha256(人物名)の先頭12桁を使う（oshi-video-makerのdbPersonSlugForNameと同じ計算。Worker側でも
 * 人物名から計算し直して一致を確認する）。PERSON_REGISTRYに登録済みの人物はWorker側でregistryのslugが優先される。
 */
export function personVideoSlug(personName: string): string {
  return `p-${createHash('sha256').update(personName, 'utf8').digest('hex').slice(0, 12)}`;
}
