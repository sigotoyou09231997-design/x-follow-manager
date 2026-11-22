import { useState } from 'react'
import './autopost.css'
import './top.css'
import { signInWithGoogle, useSupabaseAuth } from '../../hooks/useSupabaseAuth'
import { useAutopost } from '../../hooks/useAutopost'
import { useNow } from '../../hooks/useNow'
import { CHANNEL_NAMES, setPaused, type ChannelName, type ChannelSnapshot } from '../../lib/autopost/api'
import { useTopShown } from '../../lib/autopost/bulkTargets'
import { livenessOf, optimisticPause } from '../../lib/autopost/draft'
import { Icon } from '../Icon'
import { PageHero } from '../PageHero'
import { ChannelSwitchRow, SwitchRow } from './ChannelControls'
import { ChannelTextSheet } from './ChannelTextSheet'
import { RestartControl } from './RestartControl'
import { XAutopilotPanel } from './XAutopilotPanel'

// アプリを開いて最初に出る1画面。自動投稿の「いま」だけを並べる:
//   すべて止める／再開 → X・ディスコード・Yay の稼働スイッチ（1行ずつ）→ X の予定。
// 今月のAI料金・文を書き換える・文体・回数・予約投稿・フォロー整理など、ほかの機能は設定（または右下のメニュー）から開く。

interface Props {
  /** 文や細かい設定を変える画面（ディスコード・Yay・X のタブがある自動投稿の詳細）を開く。 */
  onOpenDetail: () => void
}

export function AutoPostHome({ onOpenDetail }: Props) {
  const { session, loading: authLoading, configured } = useSupabaseAuth()
  const loggedIn = !!session
  const { snapshots, loading, error, reload, applySnapshot } = useAutopost(loggedIn)
  const now = useNow(30_000)
  // 設定の「トップに出す投稿先」。外したものは、行も（X なら予定も）出さない。
  const [shown] = useTopShown()

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

  const shownChannels = CHANNEL_NAMES.filter((name) => shown[name])
  const silent = shownChannels.some((name) => livenessOf(snapshots?.[name]?.status ?? null, now) === 'silent')

  // ディスコード・Yay の保存先（SQL 005）が読めなくても、X の自動運転は使える（逆も同じ）ので、ここだけの表示にとどめる。
  const needsSetup = !!error && error.includes('autopost_')
  const channelRows =
    shownChannels.length === 0 ? null : error && !snapshots ? (
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
      shownChannels.map((name) => (
        <ChannelRow key={name} channel={name} snapshot={snapshots[name]} now={now} onChanged={applySnapshot} />
      ))
    )

  return (
    <div className="autopost autopost-home">
      <PageHero title="自動投稿" compact />

      {/* 止まっているかもしれないときだけ、いちばん上に出す（普段は文を変える画面にある）。 */}
      {silent && <RestartControl enabled={loggedIn} silent />}

      {!shown.x && shownChannels.length === 0 ? (
        // 3つとも隠しているとき。何も無い画面にせず、戻し方を出す。
        <div className="surface-card autopost--notice">
          <p>トップに出す投稿先がありません。</p>
          <p className="autopost__hint">設定の「トップに出す投稿先」で、出すものを選べます（隠しても投稿は止まりません）。</p>
        </div>
      ) : (
        <XAutopilotPanel variant="summary" onOpenDetail={onOpenDetail} channels={{ snapshots: snapshots ?? null, onChanged: applySnapshot }}>
          {channelRows}
        </XAutopilotPanel>
      )}
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
  const [textOpen, setTextOpen] = useState(false)

  async function change(next: boolean) {
    if (busy) return
    setBusy(true)
    setError(undefined)
    // 返事を待たずに切り替えて見せる（待つと、押してからスイッチが動くまで1秒ほど止まって見えた）。
    const before = snapshot
    onChanged(optimisticPause(snapshot, next, new Date()))
    try {
      onChanged(await setPaused(channel, next))
    } catch (err) {
      onChanged(before)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // トップは「名前・状態・止めるボタン」の1行だけ。いま投稿している文・過去の文の選び方は、文を変える画面にある。
  // 「文」を押すと、いま投稿している文をポップアップで見る・直す・これまでの文を呼び戻す。
  return (
    <>
      <ChannelSwitchRow
        snapshot={snapshot}
        now={now}
        busy={busy}
        error={error}
        onChange={(next) => void change(next)}
        onOpenText={() => setTextOpen(true)}
      />
      {textOpen && <ChannelTextSheet snapshot={snapshot} onChanged={onChanged} onClose={() => setTextOpen(false)} />}
    </>
  )
}
