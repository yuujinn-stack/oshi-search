import 'server-only';
import { put, list } from '@vercel/blob';

/**
 * Vercel Blobへのアップロード・参照。
 * Instagram Graph APIが要求する「公開HTTPS URL」を用意するための唯一の手段。
 * ローカルディスクへは一切書き込まない（Vercelのサーバーレス環境で安全に動く設計）。
 *
 * - 投稿画像（ig-posts/）: addRandomSuffix: true（毎回新しいURL、上書き事故を避ける）
 * - 人物写真（person-photos/）: addRandomSuffix: false + allowOverwrite: true
 *   （人物名から常に同じパスを再利用し、再アップロードで差し替えられるようにする）
 */
const POST_IMAGE_FOLDER = 'ig-posts';
const PERSON_PHOTO_FOLDER = 'person-photos';

export async function uploadPostImage(buffer: Buffer, fileName: string, contentType: string): Promise<string> {
  const blob = await put(`${POST_IMAGE_FOLDER}/${fileName}`, buffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType,
  });
  return blob.url;
}

function personPhotoPathname(personName: string, ext: string): string {
  return `${PERSON_PHOTO_FOLDER}/${personName}.${ext}`;
}

/** 人物写真を（差し替え可能な形で）アップロードする */
export async function uploadPersonPhoto(personName: string, buffer: Buffer, contentType: string): Promise<string> {
  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const blob = await put(personPhotoPathname(personName, ext), buffer, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
  });
  return blob.url;
}

/** 既にアップロード済みの人物写真があればその公開URLを返す（無ければnull） */
export async function findExistingPersonPhoto(personName: string): Promise<string | null> {
  const { blobs } = await list({ prefix: `${PERSON_PHOTO_FOLDER}/${personName}.` });
  if (blobs.length === 0) return null;
  // 複数拡張子で残っている場合は最新（uploadedAtが新しい方）を優先
  const newest = [...blobs].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
  )[0];
  return newest.url;
}
