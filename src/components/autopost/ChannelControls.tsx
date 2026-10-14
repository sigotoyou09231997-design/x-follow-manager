import type { ReactNode } from 'react'
import type { ChannelName, ChannelSnapshot } from '../../lib/autopost/api'
import { CHANNEL_LABELS } from '../../lib/autopost/api'
import { agoLabel, livenessOf, pauseStateOf } from '../../lib/autopost/draft'

// ディスコード・Yay の「Macは動いているか」と「止める／再開する」。
// 文を書き換える画面（AutoPostView）と、トップの1画面（AutoPostHome）で同じものを使う。

export function PosterStatusLine({ snapshot, now }: { snapshot: ChannelSnapshot; now: number }) {
  const { status } = snapshot
  const liveness = livenessOf(status, now)
  if (!status) {
    return <p className="autopost__status">投稿側(Mac)からの報告はまだありません</p>
  }
  const last = status.lastPost
  return (
    <p className="autopost__status">
      <span className="autopost__live">
        <span className={`autopost__dot autopost__dot--${liveness === 'alive' ? 'on' : 'off'}`} aria-hidden="true" />
        {liveness === 'alive'
          ? `Macは動いています（${agoLabel(status.at, now)}に確認）`
          : `Macから応答がありません（最後は${agoLabel(status.at, now)}）`}
      </span>
      {last && (
        <span>
          最後の投稿 {new Date(last.t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}（
          {agoLabel(last.t, now)}）・今日{status.today}件
        </span>
      )}
    </p>
  )
}

const PAUSE_DETAIL: Record<ChannelName, string> = {
  discord: '止めても Mac の投稿役は動いたままで、投稿だけを見合わせます。',
  yay: '止めても Mac の投稿役は動いたままで、投稿だけを見合わせます。いま出ている投稿は消えずに残ります。',
}

interface PauseControlProps {
  snapshot: ChannelSnapshot
  now: number
  busy: boolean
  error?: string
  onChange: (paused: boolean) => void
}

/**
 * 投稿を止める／再開するスイッチ。押しただけでは Mac はまだ知らないので、
 * 投稿役が「止まっています」と報告するまでは「停止を依頼しました」と出し、本当に止まったかを見分けられるようにする。
 */
export function PauseControl({ snapshot, now, busy, error, onChange }: PauseControlProps) {
  if (!snapshot.pauseReady) {
    return (
      <section className="surface-card autopost__pause" aria-label="投稿の停止">
        <div className="autopost__pause-text">
          <strong>止める機能は準備中です</strong>
          <span>Supabase の SQL Editor で supabase/sql/006_autopost_pause.sql を実行すると使えます。</span>
        </div>
      </section>
    )
  }

  const state = pauseStateOf(snapshot)
  const macSilent = livenessOf(snapshot.status, now) !== 'alive'
  const since = snapshot.pausedAt
    ? new Date(snapshot.pausedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const text: Record<typeof state, { title: string; detail: string }> = {
    running: { title: '自動で投稿しています', detail: PAUSE_DETAIL[snapshot.channel] },
    pausing: {
      title: '停止を依頼しました',
      detail: macSilent
        ? 'Macから応答がありません。投稿役が止まっているか、止める機能に対応していない古い版かもしれません。'
        : 'Macが受け取るまで、投稿が続くことがあります（数十秒ほど）。',
    },
    paused: {
      title: since ? `停止中（${since}から）` : '停止中',
      detail:
        snapshot.channel === 'yay'
          ? '新しい投稿は見合わせています。いま出ている投稿は、そのまま残っています。'
          : '新しい投稿は見合わせています。',
    },
    resuming: { title: '再開を依頼しました', detail: 'Macが受け取ると、投稿が再開されます。' },
  }

  const stopping = state === 'running' || state === 'resuming'
  const label = state === 'pausing' ? '停止を取り消す' : state === 'paused' ? '投稿を再開する' : '投稿を止める'

  return (
    <section className={`surface-card autopost__pause autopost__pause--${state}`} aria-label="投稿の停止">
      <div className="autopost__pause-text">
        <strong>{text[state].title}</strong>
        <span>{text[state].detail}</span>
        {error && (
          <span className="autopost__pause-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <button
        type="button"
        className={`btn ${stopping ? 'autopost__pause-stop' : state === 'paused' ? 'btn--primary' : 'btn--secondary'}`}
        onClick={() => onChange(stopping)}
        disabled={busy}
      >
        {busy ? '送っています…' : label}
      </button>
    </section>
  )
}

// ------------------------------------------------------------------ トップの1画面用（1行のスイッチ）

export type SwitchTone = 'on' | 'off' | 'warn'

interface SwitchRowProps {
  name: string
  /** on: 動いている／off: 止まっている／warn: 応答なし・依頼中・準備中など、見てほしい状態。 */
  tone: SwitchTone
  status: ReactNode
  /** 失敗などの補足。状態の下に赤字で出る。 */
  note?: ReactNode
  action?: ReactNode
}

/**
 * 「名前・いまの状態・押すボタン」を1行にしたスイッチ。トップの1画面で、X・ディスコード・Yay を同じ形で縦に並べる。
 * 詳しい説明は出さない（文を変える画面にある）。
 */
export function SwitchRow({ name, tone, status, note, action }: SwitchRowProps) {
  return (
    <div className={`switch-row switch-row--${tone}`}>
      <span className={`autopost__dot autopost__dot--${tone === 'on' ? 'on' : tone === 'warn' ? 'warn' : 'idle'}`} aria-hidden="true" />
      <div className="switch-row__text">
        <strong>{name}</strong>
        <span>{status}</span>
        {note && (
          <span className="autopost__pause-error" role="alert">
            {note}
          </span>
        )}
      </div>
      {action && <div className="switch-row__action">{action}</div>}
    </div>
  )
}

interface ChannelSwitchRowProps {
  snapshot: ChannelSnapshot
  now: number
  busy: boolean
  error?: string
  onChange: (paused: boolean) => void
}

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** ディスコード／Yay を、止める・再開するの1行にしたもの。押したあとの状態の見分け方は PauseControl と同じ。 */
export function ChannelSwitchRow({ snapshot, now, busy, error, onChange }: ChannelSwitchRowProps) {
  const name = CHANNEL_LABELS[snapshot.channel]

  if (!snapshot.pauseReady) {
    return <SwitchRow name={name} tone="warn" status="止める機能は準備中です（supabase/sql/006_autopost_pause.sql を実行すると使えます）" />
  }

  const state = pauseStateOf(snapshot)
  const liveness = livenessOf(snapshot.status, now)
  const { status } = snapshot

  const running =
    liveness === 'alive' && status
      ? [
          'Macは動いています',
          status.lastPost ? `最後 ${agoLabel(status.lastPost.t, now)}` : null,
          `今日${status.today}件`,
        ]
          .filter(Boolean)
          .join(' ・ ')
      : liveness === 'silent' && status
        ? `Macから応答がありません（最後は${agoLabel(status.at, now)}）`
        : 'Macからの報告はまだありません'

  const view: Record<typeof state, { tone: SwitchTone; status: string }> = {
    running: { tone: liveness === 'alive' ? 'on' : 'warn', status: running },
    pausing: {
      tone: 'warn',
      status:
        liveness === 'alive'
          ? '停止を依頼しました（Macが受け取るまで、投稿が続くことがあります）'
          : '停止を依頼しました。Macから応答がなく、止まるか分かりません',
    },
    paused: { tone: 'off', status: snapshot.pausedAt ? `停止中（${timeLabel(snapshot.pausedAt)}から）` : '停止中' },
    resuming: { tone: 'warn', status: '再開を依頼しました（Macが受け取ると再開します）' },
  }

  const stopping = state === 'running' || state === 'resuming'
  const action = (
    <button
      type="button"
      className={`btn btn--small ${stopping ? 'autopost__pause-stop' : state === 'paused' ? 'btn--primary' : 'btn--secondary'}`}
      onClick={() => onChange(stopping)}
      disabled={busy}
      aria-label={`${name}の${stopping ? '投稿を止める' : state === 'paused' ? '投稿を再開する' : '停止を取り消す'}`}
    >
      {busy ? '送信中…' : stopping ? '止める' : state === 'paused' ? '再開' : '取り消す'}
    </button>
  )

  return <SwitchRow name={name} tone={view[state].tone} status={view[state].status} note={error} action={action} />
}
