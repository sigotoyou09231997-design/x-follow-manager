import { useEffect, useRef, useState } from 'react'
import { CHANNEL_LABELS, SaveConflictError, saveMessages, type ChannelSnapshot } from '../../lib/autopost/api'
import { flat, isDirty, isValid, normalize, notYetPosted, slotsOf, withArchived, type Slot } from '../../lib/autopost/draft'
import { registerEditingGuard } from '../../lib/editingGuard'
import { Icon } from '../Icon'
import { Sheet } from './Sheet'
import { Box } from './TextBox'

// トップのディスコード・Yay の行の「文」から開くポップアップ。
// いま投稿している文を見る・直して保存する・これまでの文を呼び戻す、を文を変える画面に行かずにできる。
// 保存の仕組み（版つき・別の端末で先に保存されていたら上書きしない）は、文を変える画面（AutoPostView）と同じ。

interface Props {
  snapshot: ChannelSnapshot
  onChanged: (snapshot: ChannelSnapshot) => void
  onClose: () => void
}

type Message = { text: string; kind: 'ok' | 'err' }

export function ChannelTextSheet({ snapshot, onChanged, onClose }: Props) {
  const name = CHANNEL_LABELS[snapshot.channel]
  const saved = slotsOf(snapshot)
  // 書きかけ。null のあいだは保存済みの文をそのまま見せる（開いている間に Mac・別の端末で変わっても追いかける）。
  const [edit, setEdit] = useState<{ list: Slot[]; base: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<Message>()

  const draft = edit && (edit.base === snapshot.version || isDirty(edit.list, saved)) ? edit.list : saved
  const dirty = isDirty(draft, saved)
  const valid = isValid(draft, snapshot.limits.maxLength)

  // 書きかけのまま、アップデートの帯で画面を読み込み直さないよう申告しておく。
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useEffect(() => registerEditingGuard(() => dirtyRef.current), [])

  function setDraft(list: Slot[]) {
    setEdit({ list, base: snapshot.version })
  }

  function close() {
    if (dirty && !window.confirm('保存していない変更があります。閉じると消えます。閉じますか？')) return
    onClose()
  }

  async function save() {
    if (!dirty || !valid || saving) return
    const sent = JSON.stringify(normalize(draft))
    setSaving(true)
    setMessage(undefined)
    try {
      const next = await saveMessages(
        snapshot.channel,
        draft.map((slot) => slot.text),
        snapshot.version,
        draft.map((slot) => slot.hours)
      )
      onChanged(next)
      // 返事を待つあいだに打ち足されていたら、その入力は消さない。
      setEdit((prev) => (prev && JSON.stringify(normalize(prev.list)) !== sent ? prev : null))
      setMessage({ text: '保存しました（次の投稿から反映されます）', kind: 'ok' })
    } catch (err) {
      if (err instanceof SaveConflictError) onChanged(err.snapshot) // 書いた内容は消さず、最新だけ取り込む
      setMessage({ text: err instanceof Error ? err.message : String(err), kind: 'err' })
    } finally {
      setSaving(false)
    }
  }

  const list = draft.length === 0 ? [{ text: '', hours: null }] : draft
  const canAdd = snapshot.limits.maxMessages > 1 && draft.length < snapshot.limits.maxMessages

  return (
    <Sheet title={`${name}の文`} onClose={close}>
      <p className="text-sheet__lead">
        {snapshot.paused
          ? 'いまは停止中です。再開すると、保存済みの文が次の投稿から使われます。'
          : dirty
            ? '保存すると、次の投稿からこの文になります。'
            : notYetPosted(snapshot)
              ? '保存済みの文は、次の投稿から使われます（まだ投稿されていません）。'
              : 'いま投稿されている文です。直して保存すると、次の投稿から切り替わります。'}
      </p>

      <div className="text-sheet__boxes">
        {list.map((slot, i) => (
          <Box
            key={i}
            index={i}
            total={list.length}
            slot={slot}
            nowActive={!dirty && snapshot.schedule.activeIndexes.includes(i)}
            maxLength={snapshot.limits.maxLength}
            onChange={(next) => setDraft(list.map((s, j) => (j === i ? next : s)))}
            onRemove={() => setDraft(list.filter((_, j) => j !== i))}
          />
        ))}
      </div>

      {message && (
        <p className={`autopost__msg autopost__msg--${message.kind}`} role={message.kind === 'err' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      <div className="text-sheet__actions">
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={!dirty || !valid || saving}>
          {saving ? '保存しています…' : '保存する'}
        </button>
        {dirty && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setEdit(null)
              setMessage(undefined)
            }}
          >
            変更を取り消す
          </button>
        )}
        {canAdd && (
          <button type="button" className="btn btn--ghost" onClick={() => setDraft([...list, { text: '', hours: null }])}>
            <Icon name="plus" size={16} />
            {snapshot.channel === 'yay' ? '時間帯ごとの文を追加' : '順番に回す文を追加'}
          </button>
        )}
      </div>

      <section className="text-sheet__archive" aria-label="これまでの文">
        <h3 className="text-sheet__sub">これまでの文</h3>
        {snapshot.archive.length === 0 ? (
          <p className="autopost__empty">まだありません。文を変えて保存すると、前の文がここに残ります。</p>
        ) : (
          <ul className="text-sheet__history">
            {snapshot.archive.map((text) => (
              <li key={text}>
                <span className="text-sheet__history-text">{flat(text)}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  aria-label={`「${flat(text).slice(0, 20)}」を使う`}
                  onClick={() => {
                    setDraft(withArchived(draft, text, snapshot.limits.maxMessages))
                    setMessage({ text: '上の欄に入れました。直してから「保存する」を押すと切り替わります。', kind: 'ok' })
                  }}
                >
                  使う
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Sheet>
  )
}
