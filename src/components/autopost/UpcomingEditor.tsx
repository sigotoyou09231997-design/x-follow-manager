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
  /** AIに文章を整えてもらう（保存はしない。直した案が返る）。無ければ、AIのボタンは出さない。 */
  onRevise?: (text: string, instruction: string) => Promise<{ text: string | null; problems: string[] }>
}

/** 時刻が近すぎる予約は、直したつもりで即投稿されてしまう。これより先の時刻だけ受け付ける。 */
const MIN_LEAD_MS = 60_000

/**
 * 自動運転が並べた予約の、本文と投稿時刻を直す欄。
 * 本文はXの文字数の数え方で上限まで、時刻は（変えるなら）未来だけ。直さずに閉じれば、予約はそのまま。
 */
export function UpcomingEditor({ text, at, timeZone, saving, error, onSave, onCancel, onRevise }: Props) {
  const [draft, setDraft] = useState(text)
  const [instruction, setInstruction] = useState('')
  const [revising, setRevising] = useState(false)
  // AIが直した案を入れたとき、直前の本文に戻せるよう覚えておく
  const [beforeRevise, setBeforeRevise] = useState<string>()
  const [reviseNote, setReviseNote] = useState<{ text: string; kind: 'ok' | 'err' }>()

  async function revise() {
    if (!onRevise) return
    setRevising(true)
    setReviseNote(undefined)
    try {
      const reply = await onRevise(draft.trim(), instruction.trim())
      if (!reply.text) {
        setReviseNote({ text: reply.problems[0] ?? 'AIが直した案を作れませんでした', kind: 'err' })
      } else {
        setBeforeRevise(draft)
        setDraft(reply.text)
        setReviseNote({
          text:
            reply.problems.length > 0
              ? `AIの案を入れました。ただし、このままでは使えない点があります（${reply.problems.join('、')}）。手で直してください`
              : 'AIの案を入れました。保存するまで、予約には反映されません',
          kind: reply.problems.length > 0 ? 'err' : 'ok',
        })
      }
    } catch (err) {
      setReviseNote({ text: err instanceof Error ? err.message : String(err), kind: 'err' })
    } finally {
      setRevising(false)
    }
  }
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
      {onRevise && (
        <div className="xap__revise">
          <label className="xap__field">
            <span>AIで整える（指示は無くてもOK）</span>
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="例: もっと短く／やわらかく／自分らしく"
              maxLength={200}
              aria-label="AIへの指示"
            />
          </label>
          <div className="autopost__actions">
            <button type="button" className="btn btn--secondary btn--small" onClick={() => void revise()} disabled={revising || saving || !draft.trim()}>
              {revising ? '整えています…（数十秒かかります）' : 'AIで整える'}
            </button>
            {beforeRevise !== undefined && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => {
                  setDraft(beforeRevise)
                  setBeforeRevise(undefined)
                  setReviseNote(undefined)
                }}
                disabled={revising || saving}
              >
                AIの案をやめて戻す
              </button>
            )}
          </div>
          {reviseNote && (
            <p className={reviseNote.kind === 'err' ? 'autopost__pause-error' : 'xap__muted'} role={reviseNote.kind === 'err' ? 'alert' : 'status'}>
              {reviseNote.text}
            </p>
          )}
        </div>
      )}
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
