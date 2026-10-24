/**
 * ストーリーズの完成イメージを、Instagram 投稿用の PNG（1080×1920）にする（ブラウザ専用）。
 *
 * 画面のプレビューと同じ StoryDesignFrame を、画面外で幅 1080px のまま描き（cqw がちょうど 1px になる）、
 * その DOM を SVG の foreignObject に入れて canvas へ等倍で描く。同じブラウザが同じ HTML/CSS を描くので、
 * 文字サイズ・改行位置がプレビューと一致し、拡大縮小によるぼやけも出ない。
 *
 * - ガイド（Instagram UI・リンクステッカー位置）は showGuide=false で描くため、画面の表示設定に関係なく入らない。
 * - 管理画面のラベル・ボタンは StoryDesignFrame の外にあるので入らない。
 * - 画像（<img>）は data URL に埋め込んでから描く。取得できなければ失敗として扱う（画像の欠けた PNG は作らない）。
 */

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { STORY_CANVAS, type StorySlide } from '@/lib/instagram-story-templates';
import { StoryDesignFrame } from './StoryDesignPreview';

/**
 * 管理画面のページに効いている基本スタイル（Tailwind preflight・globals.css）のうち、
 * スライドの見た目に関わるもの。foreignObject の中にはページの CSS が届かないため同じ前提をそろえる。
 */
const BASE_CSS = [
  '*,*::before,*::after{box-sizing:border-box;border-width:0;border-style:solid;border-color:#e5e7eb}',
  'h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit;margin:0}',
  'p{margin:0}',
  'svg{display:block;vertical-align:middle}',
].join('');

/**
 * スライドが親（ページ）から受け継ぐ文字まわりの値。foreignObject の中では受け継がれないため、
 * 画面外で描いた要素の実際の値を写して、プレビューと同じ行の高さ・字間にする。
 */
const INHERITED_TEXT_PROPS = [
  'line-height',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'word-spacing',
  'font-kerning',
  'font-feature-settings',
  'font-variant-ligatures',
  'font-synthesis',
  'text-rendering',
  '-webkit-font-smoothing',
  'color',
] as const;

function inheritedTextStyle(el: Element): string {
  const cs = getComputedStyle(el);
  return INHERITED_TEXT_PROPS.map((p) => {
    let v = cs.getPropertyValue(p);
    // 計算値の line-height は px（例 16px×1.5=24px）になる。そのまま渡すと大きな文字まで 24px 行送りになるため倍率に戻す
    if (p === 'line-height' && v.endsWith('px')) v = String(parseFloat(v) / parseFloat(cs.fontSize));
    return v ? `${p}:${v};` : '';
  }).join('');
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('画像の読み込みに失敗しました'));
    reader.readAsDataURL(blob);
  });
}

/** <img> を data URL に置き換える（canvas が汚染されて保存できなくなるのを防ぐ） */
async function inlineImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    images.map(async (img) => {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) return;
      const res = await fetch(src, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`画像を取得できませんでした: ${src}`);
      img.setAttribute('src', await blobToDataUrl(await res.blob()));
      img.removeAttribute('srcset');
    }),
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像の描画に失敗しました'));
    img.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNGの作成に失敗しました'))), 'image/png');
  });
}

/** 1枚のスライドを 1080×1920 の PNG にする */
export async function renderStorySlidePng(templateId: string, slideIndex: number, slide: StorySlide): Promise<Blob> {
  const { width, height } = STORY_CANVAS;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-${width * 3}px;top:0;width:${width}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(createElement(StoryDesignFrame, { templateId, slideIndex, slide, showGuide: false }));
    });
    const frame = host.querySelector<HTMLElement>('[data-story-frame]');
    if (!frame) throw new Error('このスライドには保存できるデザインがありません');
    await document.fonts.ready;

    const clone = frame.cloneNode(true) as HTMLElement;
    await inlineImages(clone);
    const inherited = inheritedTextStyle(host);
    const xhtml = new XMLSerializer().serializeToString(clone);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;${inherited.replace(/"/g, "'")}">` +
      `<style>${BASE_CSS}</style>${xhtml}</div></foreignObject></svg>`;

    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas を利用できません');
    // Safari は foreignObject 内のフォントを初回描画で取りこぼすことがあるため2回描く
    ctx.drawImage(img, 0, 0, width, height);
    await new Promise((r) => setTimeout(r, 50));
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return await canvasToPng(canvas);
  } finally {
    root.unmount();
    host.remove();
  }
}

export function storyPngFileName(slideIndex: number): string {
  return `instagram-story-${slideIndex + 1}.png`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
