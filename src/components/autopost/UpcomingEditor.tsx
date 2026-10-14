import { useState } from 'react'
import { fromInputValue, toInputValue } from '../../lib/xAutopilot/editTime'
import { MAX_WEIGHTED_LENGTH, weightedLength } from '../../lib/schedule/textLength'

interface Props {
  /** 直す前の本文。 */
  text: string
  /** 直す前の投稿時刻（ISO8601）。 */
  at: string
  /** 時刻を出し入れする地域（自動運転の設定の地域）。 */
  timeZone: string
  saving: boolean
  error?: string
  /** timeChanged: 本人が時刻の欄を変えたか（変えたなら、その時刻は自動で動かさない）。 */
  onSave: (text: string, scheduledAt: string, timeChanged: boolean) => void
  onCancel: () => void
}

/** 時刻が近すぎる予約は、直したつもりで即投稿されてしまう。これより先の時刻だけ受け付ける。 */
const MIN_LEAD_MS = 60_000

/**
 * 自動運転が並べた予約の、本文と投稿時刻を直す欄。
 * 本文はXの文字数の数え方で上限まで、時刻は（変えるなら）未来だけ。直さずに閉じれば、予約はそのまま。
 */
export function UpcomingEditor({ text, at, timeZone, saving, error, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(text)
  const originalWhen = toInputValue(at, timeZone)
  const [when, setWhen] = useState(originalWhen)

  const length = weightedLength(draft.trim())
  const iso = fromInputValue(when, timeZone)
  // 入力欄は分までなので、元の時刻の秒・ミリ秒は欄に出ない。欄の値が元のままなら、時刻は変えていない（元の時刻をそのまま保存する）。
  const timeChanged = when !== originalWhen
  const problem = !draft.trim()
    ? '本文が空です'
    : length > MAX_WEIGHTED_LENGTH
      ? `文字数が上限（${MAX_WEIGHTED_LENGTH}）を超えています`
      : !iso
        ? '投稿日時を入れてください'
        : timeChanged && new Date(iso).getTime() < Date.now() + MIN_LEAD_MS
          ? '投稿日時は、いまより先の時刻にしてください'
          : undefined
  const changed = draft.trim() !== text.trim() || timeChanged

  return (
    <div className="xap__editor">
      <label className="xap__field">
        <span>本文</span>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          aria-label="本文を直す"
        />
      </label>
      <div className={`autopost__count${length > MAX_WEIGHTED_LENGTH ? ' over' : ''}`}>
        {length} / {MAX_WEIGHTED_LENGTH}
      </div>
      <label className="xap__field">
        <span>投稿日時（{timeZone === 'Asia/Tokyo' ? '日本時間' : timeZone}）</span>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="投稿日時を直す" />
      </label>
      {(problem || error) && (
        <p className="autopost__pause-error" role="alert">
          {error ?? problem}
        </p>
      )}
      <div className="autopost__actions">
        <button
          type="button"
          className="btn btn--primary btn--small"
          onClick={() => iso && onSave(draft.trim(), timeChanged ? iso : at, timeChanged)}
          disabled={saving || !!problem || !changed}
        >
          {saving ? '保存しています…' : '保存する'}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onCancel} disabled={saving}>
          やめる
        </button>
      </div>
    </div>
  )
}
