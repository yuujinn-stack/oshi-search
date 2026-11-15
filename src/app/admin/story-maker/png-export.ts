/**
 * ストーリーズのスライドを 1080×1920 の PNG にする（ブラウザ専用）。
 * 方式は /admin/instagram-stories の story-image-export.ts（Task 144）と同じ：画面外に幅 1080px で描き、
 * DOM を SVG の foreignObject に入れて canvas に等倍で描く。プレビューと同じブラウザが同じ HTML/CSS を描くので、
 * 改行位置・文字サイズがプレビューと一致し、日本語もブラウザのフォントで描かれる。
 * - ガイド（Instagram UI・スタンプ位置）は showGuide=false で描くため入らない。
 * - 画像（<img>）は data URL に埋め込んでから描く（取得できなければ失敗。欠けた PNG は作らない）。
 */

import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createStoreZip } from '@/lib/zip-store';

export const STORY_W = 1080;
export const STORY_H = 1920;

const BASE_CSS = [
  '*,*::before,*::after{box-sizing:border-box;border-width:0;border-style:solid;border-color:#e5e7eb}',
  'h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit;margin:0}',
  'p,ul,ol{margin:0;padding:0}',
  'img,svg{display:block;vertical-align:middle}',
].join('');

const INHERITED_TEXT_PROPS = [
  'line-height', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'word-spacing', 'font-kerning',
  'font-feature-settings', 'font-variant-ligatures', 'font-synthesis', 'text-rendering', '-webkit-font-smoothing', 'color',
] as const;

function inheritedTextStyle(el: Element): string {
  const cs = getComputedStyle(el);
  return INHERITED_TEXT_PROPS.map((p) => {
    let v = cs.getPropertyValue(p);
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

async function inlineImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(async (img) => {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('data:')) return;
    const res = await fetch(src, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`画像を取得できませんでした: ${src}`);
    img.setAttribute('src', await blobToDataUrl(await res.blob()));
    img.removeAttribute('srcset');
  }));
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

/** [data-story-frame] を持つ要素（幅 1080px で描かれるスライド）を PNG にする */
export async function renderStoryElementPng(element: ReactElement): Promise<Blob> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-${STORY_W * 3}px;top:0;width:${STORY_W}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(element));
    const frame = host.querySelector<HTMLElement>('[data-story-frame]');
    if (!frame) throw new Error('保存できるスライドがありません');
    // 画像の読み込みとフォントを待つ
    await Promise.all(Array.from(frame.querySelectorAll('img')).map((img) => (img.complete ? null : img.decode().catch(() => null))));
    await document.fonts.ready;

    const clone = frame.cloneNode(true) as HTMLElement;
    await inlineImages(clone);
    const inherited = inheritedTextStyle(host);
    const xhtml = new XMLSerializer().serializeToString(clone);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${STORY_W}" height="${STORY_H}" viewBox="0 0 ${STORY_W} ${STORY_H}">` +
      `<foreignObject x="0" y="0" width="${STORY_W}" height="${STORY_H}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${STORY_W}px;height:${STORY_H}px;${inherited.replace(/"/g, "'")}">` +
      `<style>${BASE_CSS}</style>${xhtml}</div></foreignObject></svg>`;

    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const canvas = document.createElement('canvas');
    canvas.width = STORY_W;
    canvas.height = STORY_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas を利用できません');
    // Safari は foreignObject 内のフォント・画像を初回描画で取りこぼすことがあるため2回描く
    ctx.drawImage(img, 0, 0, STORY_W, STORY_H);
    await new Promise((r) => setTimeout(r, 80));
    ctx.clearRect(0, 0, STORY_W, STORY_H);
    ctx.drawImage(img, 0, 0, STORY_W, STORY_H);
    return await canvasToPng(canvas);
  } finally {
    root.unmount();
    host.remove();
  }
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

export async function downloadZip(files: { name: string; blob: Blob }[], zipName: string): Promise<void> {
  const entries = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })));
  const zip = createStoreZip(entries);
  downloadBlob(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }), zipName);
}
