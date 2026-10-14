import { useState } from 'react'
import './autopost.css'
import { signInWithGoogle, useSupabaseAuth } from '../../hooks/useSupabaseAuth'
import { useAutopost } from '../../hooks/useAutopost'
import { useNow } from '../../hooks/useNow'
import { CHANNEL_NAMES, setPaused, type ChannelName, type ChannelSnapshot } from '../../lib/autopost/api'
import { livenessOf } from '../../lib/autopost/draft'
import { Icon } from '../Icon'
import { PageHero } from '../PageHero'
import { ChannelSwitchRow, SwitchRow } from './ChannelControls'
import { RestartControl } from './RestartControl'
import { XAutopilotPanel } from './XAutopilotPanel'

// アプリを開いて最初に出る1画面。自動投稿の「いま」だけを並べる:
//   X の自動運転のスイッチ → ディスコード・Yay のスイッチ → X のこれから投稿される予定。
// 文を書き換える・文体・回数・予約投稿・フォロー整理など、ほかの機能は設定から開く。

interface Props {
  /** 文や細かい設定を変える画面（ディスコード・Yay・X のタブがある自動投稿の詳細）を開く。 */
  onOpenDetail: () => void
}

export function AutoPostHome({ onOpenDetail }: Props) {
  const { session, loading: authLoading, configured } = useSupabaseAuth()
  const loggedIn = !!session
  const { snapshots, loading, error, reload, applySnapshot } = useAutopost(loggedIn)
  const now = useNow(30_000)

  if (authLoading) return <p className="loading-indicator">読み込み中…</p>

  if (!configured) {
    return (
      <div className="autopost autopost--notice">
        <p>接続情報を取得できませんでした。予約投稿と同じく、サーバーの環境変数 <code>SUPABASE_URL</code> を確認してください。</p>
      </div>
    )
  }

  if (!loggedIn) {
    return (
      <div className="autopost autopost--notice">
        <p>自動投稿の状態を見るにはログインしてください。</p>
        <button type="button" className="btn btn--primary" onClick={() => void signInWithGoogle()}>
          Googleでログイン
        </button>
      </div>
    )
  }

  const silent = CHANNEL_NAMES.some((name) => livenessOf(snapshots?.[name]?.status ?? null, now) === 'silent')

  // ディスコード・Yay の保存先（SQL 005）が読めなくても、X の自動運転は使える（逆も同じ）ので、ここだけの表示にとどめる。
  const needsSetup = !!error && error.includes('autopost_')
  const channelRows =
    error && !snapshots ? (
      <SwitchRow
        name="ディスコード・Yay"
        tone="warn"
        status={needsSetup ? '保存先がまだ用意されていません（supabase/sql/005_autopost.sql を実行すると使えます）' : '読み込みに失敗しました'}
        note={needsSetup ? undefined : error}
        action={
          <button type="button" className="btn btn--ghost btn--small" onClick={() => void reload()}>
            <Icon name="refresh" size={14} />
            もう一度
          </button>
        }
      />
    ) : loading || !snapshots ? (
      <p className="autopost__empty">読み込み中…</p>
    ) : (
      CHANNEL_NAMES.map((name) => (
        <ChannelRow key={name} channel={name} snapshot={snapshots[name]} now={now} onChanged={applySnapshot} />
      ))
    )

  return (
    <div className="autopost autopost-home">
      <PageHero title="自動投稿" subtitle="いま動いているものと、これから投稿される予定です。" compact />

      {/* 止まっているかもしれないときだけ、いちばん上に出す（普段は文を変える画面にある）。 */}
      {silent && <RestartControl enabled={loggedIn} silent />}

      <XAutopilotPanel variant="summary" onOpenDetail={onOpenDetail}>
        {channelRows}
      </XAutopilotPanel>

      <div className="surface-card link-list">
        <button type="button" className="link-row" onClick={onOpenDetail}>
          <span className="link-row__icon">
            <Icon name="edit" size={18} />
          </span>
          <span className="link-row__body">
            <span className="link-row__label">文や回数を変える</span>
            <span className="link-row__desc">ディスコード・Yay の文、X の文体・1日の投稿数</span>
          </span>
          <Icon name="chevron-right" size={18} className="link-row__chevron" />
        </button>
      </div>
    </div>
  )
}

interface ChannelRowProps {
  channel: ChannelName
  snapshot: ChannelSnapshot
  now: number
  onChanged: (snapshot: ChannelSnapshot) => void
}

/** ディスコード／Yay の1行ぶん。止める・再開するの途中状態（送信中・失敗）は、投稿先ごとに持つ。 */
function ChannelRow({ channel, snapshot, now, onChanged }: ChannelRowProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function change(next: boolean) {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      onChanged(await setPaused(channel, next))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return <ChannelSwitchRow snapshot={snapshot} now={now} busy={busy} error={error} onChange={(next) => void change(next)} />
}
