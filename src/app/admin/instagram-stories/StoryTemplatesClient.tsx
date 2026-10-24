'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import {
  STORY_TEMPLATES,
  STORY_CANVAS,
  STORY_LAYOUT,
  CTA_ROLE_LABELS,
  describeLinkPosition,
  formatStoryTemplateForCopy,
  getLinkStickerZone,
  resolveSlideLinkUrl,
  type StorySlide,
  type StoryTemplate,
  type StoryZone,
} from '@/lib/instagram-story-templates';
import { StoryDesignFrame, hasStoryDesign } from './StoryDesignPreview';
import { downloadBlob, renderStorySlidePng, storyPngFileName } from './story-image-export';
import { createStoreZip } from '@/lib/zip-store';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const handleClick = () => {
    navigator.clipboard.writeText(text).then(
      () => setState('copied'),
      () => setState('failed'),
    );
    setTimeout(() => setState('idle'), 1500);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className="px-3 py-1.5 rounded-lg border border-violet-200 text-xs font-semibold text-violet-700 bg-white hover:bg-violet-50"
    >
      {state === 'copied' ? 'コピーしました' : state === 'failed' ? 'コピー失敗' : label}
    </button>
  );
}

/** PNG保存ボタン（処理中は「保存中...」で二重クリックを防ぐ） */
function SaveButton({ label, onSave }: { label: string; onSave: () => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle');
  const handleClick = async () => {
    setState('saving');
    try {
      await onSave();
      setState('idle');
    } catch (e) {
      console.error('[instagram-stories] PNG保存に失敗', e);
      setState('failed');
      setTimeout(() => setState('idle'), 4000);
    }
  };
  return (
    <span className="inline-flex flex-col items-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === 'saving'}
        className="px-3 py-1.5 rounded-lg border border-violet-600 bg-violet-600 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60 disabled:cursor-wait"
      >
        {state === 'saving' ? '保存中...' : label}
      </button>
      {state === 'failed' && <span role="alert" className="mt-1 text-[11px] font-semibold text-red-600">画像の保存に失敗しました</span>}
    </span>
  );
}

async function saveSlidePng(template: StoryTemplate, index: number) {
  const blob = await renderStorySlidePng(template.id, index, template.slides[index]);
  downloadBlob(blob, storyPngFileName(index));
}

/** 全スライドを PNG にして instagram-stories.zip にまとめる（1枚ずつ順に描く） */
async function saveAllSlidesZip(template: StoryTemplate) {
  const entries = [];
  for (let i = 0; i < template.slides.length; i++) {
    const blob = await renderStorySlidePng(template.id, i, template.slides[i]);
    entries.push({ name: storyPngFileName(i), data: new Uint8Array(await blob.arrayBuffer()) });
  }
  const zip = createStoreZip(entries);
  downloadBlob(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }), 'instagram-stories.zip');
}

/** 1080×1920 上の縦範囲を、プレビュー枠内の % 指定に変換する */
function zoneStyle(zone: StoryZone): CSSProperties {
  return {
    top: `${(zone.top / STORY_CANVAS.height) * 100}%`,
    height: `${((zone.bottom - zone.top) / STORY_CANVAS.height) * 100}%`,
  };
}

function StoryPreview({ slide, isPR, sizeClass = 'max-w-[180px]' }: { slide: StorySlide; isPR: boolean; sizeClass?: string }) {
  const sticker = getLinkStickerZone(slide.linkPosition);
  return (
    <div
      className={`relative w-full ${sizeClass} mx-auto bg-slate-50 border border-gray-300 rounded-lg overflow-hidden text-[10px]`}
      style={{ aspectRatio: `${STORY_CANVAS.width} / ${STORY_CANVAS.height}` }}
      aria-label="1080×1920 配置イメージ"
    >
      <div className="absolute inset-x-0 bg-gray-200/70 flex items-center justify-center text-gray-500" style={zoneStyle(STORY_LAYOUT.topUi)}>
        Instagram UI
      </div>
      {isPR && (
        <span className="absolute right-1.5 bg-amber-500 text-white font-bold px-1 rounded" style={{ top: `${(STORY_LAYOUT.text.top / STORY_CANVAS.height) * 100}%` }}>
          PR
        </span>
      )}
      <div className="absolute inset-x-2 border border-dashed border-sky-400 bg-sky-50 flex items-center justify-center text-sky-700 font-semibold" style={zoneStyle(STORY_LAYOUT.text)}>
        ここに本文
      </div>
      <div className="absolute inset-x-2 border border-dashed border-emerald-400 bg-emerald-50 flex items-center justify-center text-emerald-700 font-semibold" style={zoneStyle(STORY_LAYOUT.image)}>
        ここに画像
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 w-3/4 border-2 border-violet-500 bg-violet-100 rounded-full flex items-center justify-center text-violet-700 font-bold text-center leading-tight" style={zoneStyle(sticker)}>
        リンクステッカー
      </div>
      <div className="absolute inset-x-0 bg-gray-200/70 flex items-center justify-center text-gray-500" style={zoneStyle(STORY_LAYOUT.bottomUi)}>
        Instagram UI
      </div>
    </div>
  );
}

/** デザイン済みのテンプレートは完成イメージ、それ以外は従来の配置図 */
function SlidePreview({ template, slide, index, showGuide, large = false }: { template: StoryTemplate; slide: StorySlide; index: number; showGuide: boolean; large?: boolean }) {
  if (hasStoryDesign(template.id, index)) {
    return (
      <div className={`w-full ${large ? '' : 'max-w-[280px]'} mx-auto border border-gray-300 rounded-lg overflow-hidden shadow-sm`}>
        <StoryDesignFrame templateId={template.id} slideIndex={index} slide={slide} showGuide={showGuide} />
      </div>
    );
  }
  return <StoryPreview slide={slide} isPR={template.isPR} sizeClass={large ? 'max-w-none' : undefined} />;
}

/** 1080×1920 比率の拡大プレビュー（前後のスライドへ移動できる） */
function StoryLightbox({
  template,
  index,
  showGuide,
  onToggleGuide,
  onNavigate,
  onClose,
}: {
  template: StoryTemplate;
  index: number;
  showGuide: boolean;
  onToggleGuide: () => void;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const count = template.slides.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && index < count - 1) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, count, onClose, onNavigate]);

  const navBtn = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/90 text-slate-800 disabled:opacity-30';
  return (
    <div role="dialog" aria-modal="true" aria-label={`${template.title} ${index + 1}枚目の拡大プレビュー`} className="fixed inset-0 z-50 bg-black/75 flex flex-col items-center justify-center p-3 gap-3" onClick={onClose}>
      <div className="flex items-center gap-2 flex-wrap justify-center" onClick={(e) => e.stopPropagation()}>
        <button type="button" className={navBtn} disabled={index === 0} onClick={() => onNavigate(index - 1)}>← 前へ</button>
        <span className="text-xs font-semibold text-white">{index + 1} / {count}枚目</span>
        <button type="button" className={navBtn} disabled={index === count - 1} onClick={() => onNavigate(index + 1)}>次へ →</button>
        <label className="flex items-center gap-1 text-xs text-white ml-2">
          <input type="checkbox" checked={showGuide} onChange={onToggleGuide} /> ガイド表示
        </label>
        <button type="button" className={navBtn} onClick={onClose}>閉じる</button>
      </div>
      {/* 画面の高さに合わせて 9:16 の最大サイズで表示する */}
      <div style={{ width: 'min(94vw, calc((100vh - 80px) * 9 / 16))' }} onClick={(e) => e.stopPropagation()}>
        <SlidePreview template={template} slide={template.slides[index]} index={index} showGuide={showGuide} large />
      </div>
    </div>
  );
}

function SlideCard({ slide, index, template, showGuide, onOpen }: { slide: StorySlide; index: number; template: StoryTemplate; showGuide: boolean; onOpen: () => void }) {
  const linkUrl = resolveSlideLinkUrl(template, slide);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">{index + 1}枚目</h3>
        <span className="text-[11px] text-gray-500">{CTA_ROLE_LABELS[slide.ctaRole]}</span>
      </div>

      <button type="button" onClick={onOpen} className="block w-full cursor-zoom-in" aria-label={`${index + 1}枚目を拡大プレビュー`}>
        <SlidePreview template={template} slide={slide} index={index} showGuide={showGuide} />
      </button>
      <div className="mt-2 flex items-start justify-center gap-3 flex-wrap">
        <button type="button" onClick={onOpen} className="py-1.5 text-xs font-semibold text-violet-600 hover:text-violet-700">
          拡大プレビュー
        </button>
        {/* 完成イメージがあるスライドだけ保存できる（配置図は投稿用画像ではないため） */}
        {hasStoryDesign(template.id, index) && <SaveButton label="PNGで保存" onSave={() => saveSlidePng(template, index)} />}
      </div>

      <p className="text-xs font-semibold text-gray-500 mt-4 mb-1">本文</p>
      <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 bg-gray-50 rounded-lg p-3 leading-relaxed">{slide.text}</pre>

      <p className="text-xs font-semibold text-gray-500 mt-3 mb-1">リンクCTA</p>
      <p className="text-sm font-bold text-violet-700">{slide.linkCTA}</p>

      <p className="text-xs font-semibold text-gray-500 mt-3 mb-1">リンク先URL</p>
      {linkUrl ? (
        <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-600 hover:underline break-all">
          {linkUrl}
        </a>
      ) : (
        <p className="text-xs font-semibold text-red-600">未設定</p>
      )}

      <p className="text-xs font-semibold text-gray-500 mt-3 mb-1">リンク推奨位置</p>
      <p className="text-xs text-slate-700">{describeLinkPosition(slide.linkPosition)}</p>

      <p className="text-xs font-semibold text-gray-500 mt-3 mb-1">おすすめ素材</p>
      <p className="text-xs text-slate-700 flex-1">{slide.recommendedAsset}</p>

      <div className="flex gap-2 mt-4 flex-wrap">
        <CopyButton text={slide.text} label="本文をコピー" />
        <CopyButton text={slide.linkCTA} label="CTAをコピー" />
        {linkUrl && <CopyButton text={linkUrl} label="URLをコピー" />}
      </div>
    </div>
  );
}

function TemplateDetail({ template }: { template: StoryTemplate }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            {template.title}
            {template.isPR && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">PR</span>}
          </h2>
          <p className="text-xs text-gray-500 mt-1">目的：{template.purpose}</p>
        </div>
        <div className="flex items-start gap-2 flex-wrap">
          <CopyButton text={formatStoryTemplateForCopy(template)} label={`${template.slides.length}枚まとめてコピー`} />
          {template.slides.every((_, i) => hasStoryDesign(template.id, i)) && (
            <SaveButton label={`${template.slides.length}枚まとめて保存`} onSave={() => saveAllSlidesZip(template)} />
          )}
        </div>
      </div>

      {template.isPR && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          このテンプレートはPR（推しアド）です。すべてのスライドの本文に「※PR」が入っています。消さずにそのまま投稿してください。
        </p>
      )}

      <p className="text-xs text-gray-500 mb-4">
        どのスライドで離脱しても押せるよう、すべてのスライドにリンクステッカーを置いてください。
        ステッカーは画面最下部ではなく、下端から約300〜450px上（返信欄と重ならない位置）に置き、本文・画像と重ねないでください。
      </p>

      <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 mb-4">
        <input type="checkbox" checked={showGuide} onChange={() => setShowGuide((v) => !v)} />
        Instagram UI・リンクステッカー位置のガイドを重ねて表示
      </label>

      <div className={`grid grid-cols-1 ${template.slides.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-4`}>
        {template.slides.map((slide, i) => (
          <SlideCard key={i} slide={slide} index={i} template={template} showGuide={showGuide} onOpen={() => setOpenIndex(i)} />
        ))}
      </div>

      {openIndex !== null && (
        <StoryLightbox
          template={template}
          index={openIndex}
          showGuide={showGuide}
          onToggleGuide={() => setShowGuide((v) => !v)}
          onNavigate={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}

export default function StoryTemplatesClient() {
  const [selectedId, setSelectedId] = useState(STORY_TEMPLATES[0]?.id ?? '');
  const selected = STORY_TEMPLATES.find((t) => t.id === selectedId);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {STORY_TEMPLATES.map((t, i) => {
          const active = t.id === selectedId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              aria-pressed={active}
              className={`text-left bg-white border rounded-xl p-4 transition-all ${
                active ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200 hover:border-violet-300 hover:shadow-md'
              }`}
            >
              <p className="text-xs text-gray-400 mb-1 flex items-center gap-1.5">
                テンプレート{i + 1}・{t.slides.length}枚
                {t.isPR && <span className="px-1.5 rounded-full font-bold bg-amber-100 text-amber-800">PR</span>}
              </p>
              <p className="text-sm font-bold text-slate-800">{t.title}</p>
              <p className="text-[11px] text-gray-500 mt-1 leading-relaxed line-clamp-2">{t.purpose}</p>
            </button>
          );
        })}
      </div>

      {selected && <TemplateDetail template={selected} />}
    </>
  );
}
