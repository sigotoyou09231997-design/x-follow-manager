import { useEffect, useRef, useState } from 'react'
import { CHANNEL_LABELS, SaveConflictError, saveMessages, type ChannelSnapshot } from '../../lib/autopost/api'
import { flat, isValid, normalize, slotsOf, withArchived, type Slot } from '../../lib/autopost/draft'
import { hoursLabel, type Hours } from '../../lib/autopost/hours'
import { registerEditingGuard } from '../../lib/editingGuard'
import { Icon } from '../Icon'
import { HoursPicker } from './HoursPicker'

// トップの1画面の一番上で、ディスコード／Yay の「いま投稿されている文」を1行ずつ見せ、過去の文をドロップダウンから選んで切り替える。
// 文と、その文を投稿する時間帯は、この行の「編集」でその場で直せる。
// 順番に回す文を増やす・外す、は詳細の画面（AutoPostView）。

interface Props {
  /** 名前の見出しを出すか。稼働スイッチの行の下に置くとき（行に名前がある）は false。 */
  showName?: boolean
  snapshot: ChannelSnapshot
  /** 保存の返事（や、別の端末と取り合いになって分かった最新）を、画面に取り込む。 */
  onChanged: (snapshot: ChannelSnapshot) => void
}

/** ドロップダウンの1行に出す長さ。長い文は先頭だけ（選んだあとの確認は、下の本文で見られる）。 */
const OPTION_LENGTH = 46
const short = (text: string) => {
  const line = flat(text)
  return line.length > OPTION_LENGTH ? `${line.slice(0, OPTION_LENGTH)}…` : line
}

/** 「編集」を押した1つぶんの書きかけ。保存するまで、サーバーの文は変わらない。 */
interface Editing {
  index: number
  text: string
  hours: Hours
}

export function ChannelTextRow({ snapshot, onChanged, showName = true }: Props) {
  const name = CHANNEL_LABELS[snapshot.channel]
  const [picked, setPicked] = useState('')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'err' }>()

  // 書きかけの間は、更新バナーが自動でページを読み込み直して入力を消さないよう、申告しておく。
  const editingRef = useRef(false)
  editingRef.current = editing !== null
  useEffect(() => registerEditingGuard(() => editingRef.current), [])

  // 過去の文。いま使っている文は、選んでも変わらないので出さない。
  const current = new Set(snapshot.messages)
  const past = snapshot.archive.filter((text) => !current.has(text))

  async function apply() {
    if (picked === '' || saving) return
    const text = past[Number(picked)]
    if (text === undefined) return
    const draft = slotsOf(snapshot)
    const next = withArchived(draft, text, snapshot.limits.maxMessages)
    if (next === draft) {
      setNotice({ text: `${name}は、順番に回す文がいっぱいです。「文や回数を変える」で、外してから選んでください`, kind: 'err' })
      return
    }
    setSaving(true)
    setNotice(undefined)
    try {
      onChanged(
        await saveMessages(
          snapshot.channel,
          next.map((slot) => slot.text),
          snapshot.version,
          next.map((slot) => slot.hours)
        )
      )
      setPicked('')
      setNotice({ text: '切り替えました（次の投稿から、この文になります）', kind: 'ok' })
    } catch (err) {
      // 別の端末で先に保存されていたら、最新の中身だけ取り込む（選んだ文は、選び直してもらう）
      if (err instanceof SaveConflictError) onChanged(err.snapshot)
      setNotice({ text: err instanceof Error ? err.message : String(err), kind: 'err' })
    } finally {
      setSaving(false)
    }
  }

  function startEdit(index: number) {
    if (saving || editSaving) return
    setNotice(undefined)
    setEditing({ index, text: snapshot.messages[index] ?? '', hours: snapshot.hours[index] ?? null })
  }

  async function saveEdit() {
    if (!editing || editSaving || saving) return
    const base = slotsOf(snapshot)
    if (base[editing.index] === undefined) return
    const next: Slot[] = normalize(base.map((slot, i) => (i === editing.index ? { text: editing.text, hours: editing.hours } : slot)))
    if (!isValid(next, snapshot.limits.maxLength)) {
      const cut = next[editing.index]
      setNotice({
        text:
          cut.text.length === 0
            ? '文が空です。書いてから保存してください（この文をやめるときは、詳細の画面で外します）'
            : cut.text.length > snapshot.limits.maxLength
              ? `文が長すぎます（${snapshot.limits.maxLength}文字まで）`
              : '投稿する時間を、1時間以上選んでください',
        kind: 'err',
      })
      return
    }
    // 何も変えていなければ、保存せず閉じる（版を無駄に進めない）。
    if (JSON.stringify(next) === JSON.stringify(normalize(base))) {
      setEditing(null)
      setNotice(undefined)
      return
    }
    setEditSaving(true)
    setNotice(undefined)
    try {
      onChanged(
        await saveMessages(
          snapshot.channel,
          next.map((slot) => slot.text),
          snapshot.version,
          next.map((slot) => slot.hours)
        )
      )
      setEditing(null)
      setNotice({ text: '保存しました（次の投稿から、この文になります）', kind: 'ok' })
    } catch (err) {
      // 別の端末で先に保存されていたら、最新の中身だけ取り込む（書いた内容は消さない）。文の数が減っていたら、書きかけは閉じる。
      if (err instanceof SaveConflictError) {
        onChanged(err.snapshot)
        if (err.snapshot.messages.length <= editing.index) setEditing(null)
      }
      setNotice({ text: err instanceof Error ? err.message : String(err), kind: 'err' })
    } finally {
      setEditSaving(false)
    }
  }

  return (
    <div className="channel-row" role="group" aria-label={`${name}の投稿文`}>
      {showName && <strong className="channel-row__name">{name}</strong>}

      {snapshot.messages.length === 0 ? (
        <p className="channel-row__empty">まだ文がありません。「文や回数を変える」で書いてください。</p>
      ) : (
        <ul className="channel-row__list">
          {snapshot.messages.map((text, i) => {
            const hours = snapshot.hours[i] ?? null
            const label = snapshot.messages.length > 1 ? `${i + 1}つ目の文` : '投稿する文'
            if (editing?.index === i) {
              const length = editing.text.trim().length
              return (
                <li key={i} className="channel-row__item channel-row__item--editing">
                  {snapshot.messages.length > 1 && <span className="channel-row__no">{i + 1}つ目</span>}
                  <textarea
                    className="channel-row__textarea"
                    value={editing.text}
                    rows={Math.min(8, Math.max(3, editing.text.split('\n').length + 1))}
                    onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                    aria-label={`${name}の${label}`}
                    disabled={editSaving}
                    autoFocus
                  />
                  <div className="channel-row__edit-foot">
                    <HoursPicker hours={editing.hours} onChange={(next) => setEditing({ ...editing, hours: next })} name={`${name}の${label}`} />
                    <span className={`autopost__count${length > snapshot.limits.maxLength ? ' over' : ''}`}>{length}文字</span>
                  </div>
                  <div className="channel-row__edit-actions">
                    <button type="button" className="btn btn--primary btn--small" onClick={() => void saveEdit()} disabled={editSaving}>
                      {editSaving ? '保存しています…' : '保存する'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => {
                        setEditing(null)
                        setNotice(undefined)
                      }}
                      disabled={editSaving}
                    >
                      やめる
                    </button>
                  </div>
                </li>
              )
            }
            return (
              <li key={i} className="channel-row__item">
                <div className="channel-row__head">
                  {snapshot.messages.length > 1 && <span className="channel-row__no">{i + 1}つ目</span>}
                  {hours !== null && <span className="channel-row__hours">{hoursLabel(hours)}</span>}
                  <button
                    type="button"
                    className="btn btn--ghost btn--small channel-row__edit"
                    onClick={() => startEdit(i)}
                    aria-label={`${name}の${label}を編集`}
                    disabled={editing !== null}
                  >
                    <Icon name="edit" size={14} />
                    編集
                  </button>
                </div>
                <span className="channel-row__body">{text}</span>
              </li>
            )
          })}
        </ul>
      )}

      {past.length === 0 ? (
        <p className="channel-row__empty">過去の文はまだありません。文を変えて保存すると、前の文がここから選べます。</p>
      ) : (
        <div className="channel-row__pick">
          <select value={picked} onChange={(e) => setPicked(e.target.value)} aria-label={`${name}の過去の文`}>
            <option value="">過去の文から選ぶ</option>
            {past.map((text, i) => (
              <option key={`${i}-${text}`} value={String(i)}>
                {short(text)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--secondary btn--small" onClick={() => void apply()} disabled={picked === '' || saving}>
            {saving ? '切り替え中…' : 'この文にする'}
          </button>
        </div>
      )}

      {notice && (
        <p className={`autopost__msg autopost__msg--${notice.kind}`} role={notice.kind === 'err' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
    </div>
  )
}
