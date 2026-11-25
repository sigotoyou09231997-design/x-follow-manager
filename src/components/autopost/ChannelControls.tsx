import type { ReactNode } from 'react'
import type { ChannelName, ChannelSnapshot } from '../../lib/autopost/api'
import { CHANNEL_LABELS } from '../../lib/autopost/api'
import { agoLabel, livenessOf, pauseStateOf, problemLabel, problemOf } from '../../lib/autopost/draft'
import { Icon, type IconName } from '../Icon'
import { Toggle } from '../Toggle'

export { Toggle }

// ディスコード・Yay の「Macは動いているか」と「止める／再開する」。
// 文を書き換える画面（AutoPostView）と、トップの1画面（AutoPostHome）で同じものを使う。

export function PosterStatusLine({ snapshot, now }: { snapshot: ChannelSnapshot; now: number }) {
  const { status } = snapshot
  const liveness = livenessOf(status, now)
  if (!status) {
    return (
      <p className="autopost__status">
        {snapshot.channel === 'xrepeat'
          ? snapshot.messages.length === 0
            ? '文を保存すると、サーバーから投稿が始まります（Mac は使いません）'
            : 'まもなく最初の投稿をします（サーバーから。Mac は使いません）'
          : '投稿側(Mac)からの報告はまだありません'}
      </p>
    )
  }
  const last = status.lastPost
  const problem = problemOf(snapshot, now)
  return (
    <p className="autopost__status">
      {problem && <span className="autopost__problem">{problemLabel(problem)}</span>}
      <span className="autopost__live">
        <span className={`autopost__dot autopost__dot--${liveness === 'alive' ? 'on' : 'off'}`} aria-hidden="true" />
        {status.server
          ? 'サーバーから投稿しています（Mac は使いません）'
          : liveness === 'alive'
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
  xrepeat: '止めると、次の投稿から出さなくなります（1分以内）。いま X に出ている投稿は消えずに残ります。',
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
    running: snapshot.schedule.idle
      ? {
          title: '投稿を休む時間帯です',
          detail: `いま（${snapshot.schedule.hour}時台）に使える文が無いので、投稿を見合わせています${
            snapshot.schedule.nextHour !== null ? `（${snapshot.schedule.nextHour}時から再開）` : ''
          }。`,
        }
      : { title: '自動で投稿しています', detail: PAUSE_DETAIL[snapshot.channel] },
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


export type SwitchTone = 'on' | 'off' | 'warn' | 'rest'

/** 投稿先ごとの札のアイコン。行が文字だけで始まると、どのサービスの行か一瞬で判別できない。 */
const CHANNEL_ICONS: Record<ChannelName, IconName> = {
  discord: 'board',
  yay: 'users',
  xrepeat: 'repeat',
}

interface SwitchRowProps {
  name: string
  /** 行の左に置く札のアイコン。無ければ札を出さない（ディスコード・Yay をまとめた案内の行など）。 */
  icon?: IconName
  /**
   * on: 動いている／off: 止まっている／warn: 応答なし・依頼中・準備中など、見てほしい状態。
   * rest: 文の時間帯の外で、投稿を休んでいる。動いていて正常な状態なので、止まっている・要注意の橙は付けない。
   */
  tone: SwitchTone
  status: ReactNode
  /** 失敗などの補足。状態の下に赤字で出る。 */
  note?: ReactNode
  action?: ReactNode
}

/**
 * 「名前・いまの状態・押すボタン」を1行にしたスイッチ。トップの1画面で、X・ディスコード・Yay を同じ形で縦に並べる。
 * 詳しい説明は出さない（文を変える画面にある）。
 *
 * 行の頭は、どのサービスかを示すアイコンの札。動いているかどうかの点は、札ではなく状態の文の先頭に置く
 * （札と点を横に2つ並べると、どちらが「状態」なのか分からなくなるため）。
 */
export function SwitchRow({ name, icon, tone, status, note, action }: SwitchRowProps) {
  return (
    <div className={`switch-row switch-row--${tone}`}>
      {icon && (
        <span className="switch-row__badge" aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
      )}
      <div className="switch-row__text">
        <strong>{name}</strong>
        <span className="switch-row__status">
          <span className={`autopost__dot autopost__dot--${tone === 'on' ? 'on' : tone === 'warn' ? 'warn' : 'idle'}`} aria-hidden="true" />
          {status}
        </span>
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
  /** 「文」ボタン（いま投稿している文を見る・直す）を押したとき。無ければボタンを出さない。 */
  onOpenText?: () => void
}

/** 行の右の「文」ボタン。いま投稿している文を、ポップアップで見る・直す。 */
export function TextButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" className="text-button" onClick={onClick} aria-label={`${name}の文を見る・直す`}>
      <Icon name="edit" size={15} />
      <span className="text-button__label">文</span>
    </button>
  )
}

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** ディスコード／Yay を、止める・再開するの1行にしたもの。押したあとの状態の見分け方は PauseControl と同じ。 */
export function ChannelSwitchRow({ snapshot, now, busy, error, onChange, onOpenText }: ChannelSwitchRowProps) {
  const name = CHANNEL_LABELS[snapshot.channel]
  const icon = CHANNEL_ICONS[snapshot.channel]

  if (!snapshot.pauseReady) {
    return <SwitchRow name={name} icon={icon} tone="warn" status="止める機能は準備中です（supabase/sql/006_autopost_pause.sql を実行すると使えます）" />
  }

  const state = pauseStateOf(snapshot)
  const liveness = livenessOf(snapshot.status, now)
  const { status } = snapshot
  // 動いているのに投稿できていない（2026-11-25、Yay のログイン切れ）・止まった、を「動いています」より先に出す
  const problem = problemOf(snapshot, now)

  // 動いているあいだは、点の色（青緑）が「Macが動いている」を伝えるので、文は最後の投稿と今日の件数だけにする。
  const running =
    liveness === 'alive' && status
      ? [status.lastPost ? `${agoLabel(status.lastPost.t, now)}に投稿` : '投稿待ち', `今日${status.today}件`].join(' ・ ')
      : liveness === 'silent' && status
        ? `Macから応答がありません（最後は${agoLabel(status.at, now)}）`
        : snapshot.channel === 'xrepeat'
          ? // サーバーが投稿する投稿先。まだ1度も投稿していない（文が無い・最初の1分を待っている）
            snapshot.messages.length === 0
            ? '文がまだありません（「文」から書くと始まります）'
            : 'まもなく最初の投稿をします'
          : 'Macからの報告はまだありません'

  const view: Record<typeof state, { tone: SwitchTone; status: string }> = {
    running: problem
      ? { tone: 'warn', status: problemLabel(problem, { short: true }) }
      : snapshot.schedule.idle && liveness === 'alive'
        ? {
            tone: 'rest',
            status: `いまは投稿を休む時間帯です${snapshot.schedule.nextHour !== null ? `（${snapshot.schedule.nextHour}時から再開）` : ''}`,
          }
        : {
            tone: liveness === 'alive' ? 'on' : snapshot.channel === 'xrepeat' && !status ? (snapshot.messages.length === 0 ? 'rest' : 'on') : 'warn',
            status: running,
          },
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

  // オン＝動いている（running）か、再開を頼んで Mac の受け取り待ち（resuming）。押すと止める。
  // オフ＝止まっている（paused）か、停止を頼んで受け取り待ち（pausing）。押すと再開（停止の取り消し）。
  const stopping = state === 'running' || state === 'resuming'
  const action = (
    <>
      {onOpenText && <TextButton name={name} onClick={onOpenText} />}
      <Toggle
        on={stopping}
        pending={busy || state === 'pausing' || state === 'resuming'}
        disabled={busy}
        label={`${name}の自動投稿`}
        onClick={() => onChange(stopping)}
      />
    </>
  )

  return <SwitchRow name={name} icon={icon} tone={view[state].tone} status={view[state].status} note={error} action={action} />
}
