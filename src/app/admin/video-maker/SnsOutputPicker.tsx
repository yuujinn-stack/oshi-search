'use client';

// /admin/video-maker の「出力先SNS」（Instagramのみ / TikTokのみ / 両方）と「SNS別CTA設定」。
// 動画の大部分は共通で、最後のCTAだけを SNS ごとに変える（oshi-video-maker の scripts/sns/snsVariants.ts）。
// 設定は Redis に1件保存し（/api/admin/video-jobs/sns-cta-settings）、生成するときの内容をジョブごとに保存する。

import { useState } from 'react';
import {
  DEFAULT_SNS_CTA,
  resolveSnsSubmission,
  SNS_CTA_AUDIO_FILE_PREFIX,
  SNS_CTA_DURATION_MAX,
  SNS_CTA_DURATION_MIN,
  SNS_OUTPUT_CHOICES,
  SNS_TARGET_LABELS,
  SNS_TARGETS,
  snsCtaAudioKey,
  type SnsCtaAudioReport,
  type SnsCtaCapability,
  type SnsCtaSetting,
  type SnsCtaSettings,
  type SnsOutputChoice,
  type SnsTarget,
} from '@/lib/video-sns-output';
import CopyButton from './CopyButton';

const MODE_LABELS: Record<SnsCtaSetting['mode'], string> = {
  template: 'テンプレートのCTAのまま（プロフィールのリンク等）',
  search: '検索窓CTA（「推しサーチ」で検索）に差し替える',
};

function CtaAudioStatus({ setting, narrationMode, audio }: { setting: SnsCtaSetting; narrationMode: string | null; audio: SnsCtaAudioReport | null | undefined }) {
  if (setting.mode !== 'search') return null;
  const key = snsCtaAudioKey(setting.narration);
  const entry = audio?.entries.find((e) => e.key === key) ?? null;
  const fileName = `${SNS_CTA_AUDIO_FILE_PREFIX}${key}.wav`;
  return (
    <div className={`rounded p-2 text-xs space-y-1 ${entry ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
      <p>
        {entry
          ? `🟢 このナレーションの CapCut 音声は登録済みです（${entry.durationSec.toFixed(2)}秒）。CapCut 音声の動画にも使えます。`
          : `🔴 このナレーションの CapCut 音声が未登録です。${narrationMode === 'capcut' ? 'CapCut 音声の動画では、この SNS 版が作れません（もう一方は作れます）。' : '音声なしの動画は作れます。'}`}
      </p>
      {!entry && (
        <div className="space-y-1">
          <p>CapCut で次の読みを読み上げ、WAV を次のファイル名で SNS別CTA の受信フォルダへ書き出してください（全テンプレート共通・1回だけ）。</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="bg-white/70 px-1 rounded">{setting.narrationKana}</code>
            <CopyButton text={setting.narrationKana} label="読みをコピー" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="bg-white/70 px-1 rounded">{fileName}</code>
            <CopyButton text={fileName} label="ファイル名をコピー" />
          </div>
          {audio?.inboxPath && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="bg-white/70 px-1 rounded break-all">{audio.inboxPath}</code>
              <CopyButton text={audio.inboxPath} label="受信フォルダをコピー" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SettingEditor({ target, value, onChange }: { target: SnsTarget; value: SnsCtaSetting; onChange: (v: SnsCtaSetting) => void }) {
  const set = <K extends keyof SnsCtaSetting>(k: K, v: SnsCtaSetting[K]) => onChange({ ...value, [k]: v });
  const field = 'w-full border border-gray-300 rounded px-2 py-1 text-sm';
  const disabled = value.mode !== 'search';
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap gap-4">
        {(['template', 'search'] as const).map((m) => (
          <label key={m} className="cursor-pointer">
            <input type="radio" name={`sns-cta-mode-${target}`} className="mr-1" checked={value.mode === m} onChange={() => set('mode', m)} />
            {MODE_LABELS[m]}
          </label>
        ))}
      </div>
      {value.mode === 'template' && (
        <p className="text-gray-500">テンプレートごとの既存のCTA（文言・ナレーション・字幕）をそのまま使います。下の文言は「検索窓CTA」に切り替えたときに使います。</p>
      )}
      <div className={`grid gap-2 md:grid-cols-2 ${disabled ? 'opacity-50' : ''}`}>
        <label className="space-y-0.5">
          <span className="text-gray-600">CTAナレーション（字幕にも使う）</span>
          <input className={field} value={value.narration} maxLength={40} disabled={disabled} onChange={(e) => set('narration', e.target.value)} />
        </label>
        <label className="space-y-0.5">
          <span className="text-gray-600">ナレーションの読み（ひらがな。CapCut の読み上げ用）</span>
          <input className={field} value={value.narrationKana} maxLength={60} disabled={disabled} onChange={(e) => set('narrationKana', e.target.value)} />
        </label>
        <label className="space-y-0.5">
          <span className="text-gray-600">CTAテロップ（2行まで。「」で囲んだ語を強調）</span>
          <textarea className={field} rows={2} value={value.telop} maxLength={40} disabled={disabled} onChange={(e) => set('telop', e.target.value)} />
        </label>
        <div className="space-y-2">
          <label className="block space-y-0.5">
            <span className="text-gray-600">検索窓の文字</span>
            <input className={field} value={value.searchText} maxLength={16} disabled={disabled} onChange={(e) => set('searchText', e.target.value)} />
          </label>
          <label className="block space-y-0.5">
            <span className="text-gray-600">サブテキスト</span>
            <input className={field} value={value.subText} maxLength={40} disabled={disabled} onChange={(e) => set('subText', e.target.value)} />
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.showSubText} disabled={disabled} onChange={(e) => set('showSubText', e.target.checked)} />
          <span className="text-gray-600">URL表示（サブテキストを下部に小さく表示）</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-gray-600">CTAの表示時間</span>
          <input
            type="number"
            className="w-20 border border-gray-300 rounded px-2 py-1 text-sm"
            min={SNS_CTA_DURATION_MIN}
            max={SNS_CTA_DURATION_MAX}
            step={0.1}
            value={value.durationSec}
            disabled={disabled}
            onChange={(e) => set('durationSec', Number(e.target.value))}
          />
          <span className="text-gray-500">秒（ナレーションが長い場合は読み終わるまで自動で延長）</span>
        </label>
      </div>
    </div>
  );
}

export default function SnsOutputPicker({
  capability,
  narrationMode,
  choice,
  onChoice,
  settings,
  onSettings,
  savedSettings,
  onSaved,
  storage,
  scope = null,
  audio,
}: {
  capability: SnsCtaCapability | null | undefined;
  narrationMode: string | null;
  choice: SnsOutputChoice;
  onChoice: (c: SnsOutputChoice) => void;
  /** 画面で編集中の設定（生成にはこの内容を使う） */
  settings: SnsCtaSettings;
  onSettings: (s: SnsCtaSettings) => void;
  /** 保存済みの設定（編集中の内容と比べて未保存の変更を表示する） */
  savedSettings: SnsCtaSettings;
  onSaved: (s: SnsCtaSettings) => void;
  /** 設定の保存先（Redis）が使えるか */
  storage: boolean;
  /** 設定を保存する環境（本番以外は本番とは別のキーに保存する） */
  scope?: 'production' | 'preview' | 'local' | null;
  audio: SnsCtaAudioReport | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SnsTarget>('tiktok');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const submission = resolveSnsSubmission({ capability, narrationMode, choice, settings });
  const dirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  async function save(reset: boolean) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/video-jobs/sns-cta-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { reset: true } : { settings }),
      });
      const data = (await res.json().catch(() => ({}))) as { settings?: SnsCtaSettings; error?: string };
      if (!res.ok || !data.settings) throw new Error(data.error ?? `保存できませんでした（${res.status}）`);
      onSaved(data.settings);
      onSettings(data.settings);
      setMsg({ kind: 'ok', text: reset ? '既定の設定に戻しました。' : '保存しました。' });
    } catch (err) {
      setMsg({ kind: 'error', text: String(err instanceof Error ? err.message : err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-sm">
        {SNS_OUTPUT_CHOICES.map((c) => (
          <label key={c.value} className="cursor-pointer">
            <input type="radio" name="vm-sns-output" className="mr-1" checked={choice === c.value} onChange={() => onChoice(c.value)} />
            {c.label}
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        動画の内容は共通で、最後のCTAだけを SNS ごとに変えます（Instagram：{settings.instagram.mode === 'template' ? 'テンプレートのCTAのまま' : '検索窓CTA'}／
        TikTok：{settings.tiktok.mode === 'template' ? 'テンプレートのCTAのまま' : `「${settings.tiktok.narration}」`}）。両方を選ぶと2種類のMP4・SRTを作ります。
      </p>
      {submission.note && <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">⚠ {submission.note}</p>}
      {submission.blocked && <p className="text-xs text-red-700 bg-red-50 rounded p-2">⛔ {submission.blocked} 出力先SNSを変えてください。</p>}
      {choice !== 'instagram' && settings.tiktok.mode === 'search' && narrationMode === 'capcut' && !submission.blocked && (
        <CtaAudioStatus setting={settings.tiktok} narrationMode={narrationMode} audio={audio} />
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-violet-600 hover:underline">
        {open ? '▲ SNS別CTA設定を閉じる' : '▼ SNS別CTA設定（ナレーション・テロップ・URL表示・表示時間）'}
        {dirty ? '（未保存の変更あり。この内容で生成されます）' : ''}
      </button>
      {open && (
        <div className="border border-gray-200 rounded-lg p-3 space-y-3">
          <div className="flex gap-2">
            {SNS_TARGETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded text-xs ${tab === t ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-700'}`}
              >
                {SNS_TARGET_LABELS[t]}
              </button>
            ))}
          </div>
          <SettingEditor target={tab} value={settings[tab]} onChange={(v) => onSettings({ ...settings, [tab]: v })} />
          <CtaAudioStatus setting={settings[tab]} narrationMode={narrationMode} audio={audio} />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button type="button" disabled={saving || !storage || !dirty} onClick={() => void save(false)} className="px-3 py-1 rounded bg-violet-600 text-white disabled:opacity-40">
              {saving ? '保存中…' : '設定を保存'}
            </button>
            <button type="button" disabled={saving} onClick={() => onSettings(savedSettings)} className="text-gray-600 hover:underline disabled:opacity-40">
              編集を取り消す
            </button>
            <button
              type="button"
              disabled={saving || !storage}
              onClick={() => {
                if (window.confirm('SNS別CTA設定を既定（TikTok：「気になったら、推しサーチで検索！」、Instagram：テンプレートのCTAのまま）に戻しますか？')) void save(true);
              }}
              className="text-gray-600 hover:underline disabled:opacity-40"
            >
              既定に戻す
            </button>
            {scope && scope !== 'production' && storage && (
              <span className="text-sky-700">この環境（{scope === 'preview' ? 'Preview' : 'ローカル'}）の設定です。本番の設定とは別に保存され、本番には影響しません。</span>
            )}
            {!storage && <span className="text-amber-700">設定の保存先（Redis）が無いため保存できません（既定値で生成します）。</span>}
            {msg && <span className={msg.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}>{msg.text}</span>}
          </div>
          <p className="text-[11px] text-gray-500">
            作成済みのジョブには、生成したときの設定が残ります（設定を変えても作成済みの動画は変わりません）。
            TikTok のフォロワーが1,000人を超えてプロフィールリンクが使えるようになったら、TikTok を「テンプレートのCTAのまま」にするか、文言を変えて保存してください。
          </p>
        </div>
      )}
    </div>
  );
}

export { DEFAULT_SNS_CTA, resolveSnsSubmission };
