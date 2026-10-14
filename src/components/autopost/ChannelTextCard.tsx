import { useState } from 'react'
import { CHANNEL_LABELS, SaveConflictError, saveMessages, type ChannelSnapshot } from '../../lib/autopost/api'
import { flat, withArchived } from '../../lib/autopost/draft'

// トップの1画面で、ディスコード／Yay の「いま投稿されている文」を見せ、過去の文をドロップダウンから選んで切り替える。
// 文を自分で書き換える・順番に回す文を増やす・外す、は詳細の画面（AutoPostView）。

interface Props {
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

export function ChannelTextCard({ snapshot, onChanged }: Props) {
  const name = CHANNEL_LABELS[snapshot.channel]
  const [picked, setPicked] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'err' }>()

  // 過去の文。いま使っている文は、選んでも変わらないので出さない。
  const current = new Set(snapshot.messages)
  const past = snapshot.archive.filter((text) => !current.has(text))

  async function apply() {
    if (picked === '' || saving) return
    const text = past[Number(picked)]
    if (text === undefined) return
    const next = withArchived(snapshot.messages, text, snapshot.limits.maxMessages)
    if (next === snapshot.messages) {
      setNotice({ text: `${name}は、順番に回す文がいっぱいです。「文や回数を変える」で、外してから選んでください`, kind: 'err' })
      return
    }
    setSaving(true)
    setNotice(undefined)
    try {
      onChanged(await saveMessages(snapshot.channel, next, snapshot.version))
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

  return (
    <section className="surface-card channel-text" aria-label={`${name}の投稿文`}>
      <h3 className="channel-text__title">{name}の投稿文</h3>

      {snapshot.messages.length === 0 ? (
        <p className="autopost__empty">まだ文がありません。「文や回数を変える」で書いてください。</p>
      ) : (
        <ul className="channel-text__list">
          {snapshot.messages.map((text, i) => (
            <li key={i} className="channel-text__item">
              {snapshot.messages.length > 1 && <span className="channel-text__no">{i + 1}つ目</span>}
              <span className="channel-text__body">{text}</span>
            </li>
          ))}
        </ul>
      )}

      {past.length === 0 ? (
        <p className="xap__muted">過去の文はまだありません。文を変えて保存すると、前の文がここから選べます。</p>
      ) : (
        <div className="channel-text__pick">
          <label className="xap__field">
            <span>過去の文から選ぶ</span>
            <select value={picked} onChange={(e) => setPicked(e.target.value)} aria-label={`${name}の過去の文`}>
              <option value="">選んでください</option>
              {past.map((text, i) => (
                <option key={`${i}-${text}`} value={String(i)}>
                  {short(text)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn--secondary btn--small" onClick={() => void apply()} disabled={picked === '' || saving}>
            {saving ? '切り替えています…' : 'この文にする'}
          </button>
        </div>
      )}

      {notice && (
        <p className={`autopost__msg autopost__msg--${notice.kind}`} role={notice.kind === 'err' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
    </section>
  )
}
