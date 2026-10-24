'use client';

import { useState, type CSSProperties } from 'react';
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

/** 1080×1920 上の縦範囲を、プレビュー枠内の % 指定に変換する */
function zoneStyle(zone: StoryZone): CSSProperties {
  return {
    top: `${(zone.top / STORY_CANVAS.height) * 100}%`,
    height: `${((zone.bottom - zone.top) / STORY_CANVAS.height) * 100}%`,
  };
}

function StoryPreview({ slide, isPR }: { slide: StorySlide; isPR: boolean }) {
  const sticker = getLinkStickerZone(slide.linkPosition);
  return (
    <div
      className="relative w-full max-w-[180px] mx-auto bg-slate-50 border border-gray-300 rounded-lg overflow-hidden text-[10px]"
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

function SlideCard({ slide, index, template }: { slide: StorySlide; index: number; template: StoryTemplate }) {
  const isPR = template.isPR;
  const linkUrl = resolveSlideLinkUrl(template, slide);
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800">{index + 1}枚目</h3>
        <span className="text-[11px] text-gray-500">{CTA_ROLE_LABELS[slide.ctaRole]}</span>
      </div>

      <StoryPreview slide={slide} isPR={isPR} />

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
        <CopyButton text={formatStoryTemplateForCopy(template)} label={`${template.slides.length}枚まとめてコピー`} />
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {template.slides.map((slide, i) => (
          <SlideCard key={i} slide={slide} index={i} template={template} />
        ))}
      </div>
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
