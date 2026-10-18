import { useEffect, useState } from 'react'
import { X_CALLBACK_PATH } from '../../lib/schedule/constants'
import { completeXConnect } from '../../lib/schedule/api'
import { signInWithGoogle, signOut, useSupabaseAuth } from '../../hooks/useSupabaseAuth'
import { useScheduledPosts } from '../../hooks/useScheduledPosts'
import { isEditing } from '../../lib/editingGuard'
import type { ScheduledPost } from '../../lib/schedule/types'
import { Icon } from '../Icon'
import { ComposerSheet } from './ComposerSheet'
import { ScheduledPostList } from './ScheduledPostList'
import { ScheduleSummaryBar } from './ScheduleSummaryBar'
import { XConnectCard } from './XConnectCard'

interface Props {
  /**
   * 増えるたびにコンポーザーを開く。外から作成画面を開きたいときの入口（いまは App からは使っていない）。
   * boolean だと「開いて閉じてもう一度押す」が同じ値になって効かないため、
   * 押された回数をそのまま渡してもらう。
   */
  composeRequest?: number
  /** composeRequest と同時に渡る。true なら、開くコンポーザーをAI下書き支援が開いた状態で始める。 */
  composeStartWithAi?: boolean
  /**
   * composeRequest を受けて開いたら呼ぶ。呼び出し側は、頼みを使い切ったことにして 0 へ戻す。
   * 戻さないと、別のタブへ行って予約投稿タブに戻る（＝この画面が作り直される）たびに、
   * 残っていた同じ頼みでコンポーザーが勝手にまた開く（AIから来たなら、AIパネルを開いたまま）。
   */
  onComposeHandled?: () => void
}

export function ScheduleView({
  composeRequest = 0,
  composeStartWithAi = false,
  onComposeHandled,
}: Props) {
  const { session, loading: authLoading, configured, configStatus } = useSupabaseAuth()
  const loggedIn = !!session
  const { posts, summary, xAccount, loading, error, reload } = useScheduledPosts(loggedIn)

  // 投稿作成は前面にかぶせて出す ComposerSheet 一本（以前は一覧の上に開く別パネルもあったが統一した）。
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetStartWithAi, setSheetStartWithAi] = useState(false)
  const [editing, setEditing] = useState<ScheduledPost>()
  const [callbackMessage, setCallbackMessage] = useState<string>()
  const [callbackError, setCallbackError] = useState<string>()

  // Xの認可画面から /x-callback に戻ってきたときのトークン交換。
  useEffect(() => {
    if (!loggedIn) return
    if (window.location.pathname !== X_CALLBACK_PATH) return

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const denied = params.get('error')

    // URLを先に戻しておく。リロードで二重にトークン交換しないため。
    window.history.replaceState({}, '', '/')

    if (denied) {
      setCallbackError('Xとの連携がキャンセルされました')
      return
    }
    if (!code || !state) return

    void (async () => {
      try {
        const username = await completeXConnect(code, state)
        setCallbackMessage(`@${username} と連携しました`)
        await reload()
      } catch (err) {
        setCallbackError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [loggedIn, reload])

  // 中央の＋、ホームの「AIで下書きを作る」から来たらコンポーザーを開く。
  useEffect(() => {
    if (composeRequest <= 0) return
    setEditing(undefined)
    setSheetStartWithAi(composeStartWithAi)
    setSheetOpen(true)
    onComposeHandled?.()
  }, [composeRequest, composeStartWithAi, onComposeHandled])

  if (authLoading) {
    return <p className="loading-indicator">読み込み中…</p>
  }

  if (!configured) {
    // どの環境変数が欠けているかまで出す。ここが分からないと、設定したのに
    // 動かないときに何を直せばよいのか画面から判断できない。
    return (
      <div className="schedule-view schedule-view--notice">
        <p>
          予約投稿の接続情報を取得できませんでした。サーバーの環境変数{' '}
          <code>SUPABASE_URL</code> と <code>VITE_SUPABASE_ANON_KEY</code> を確認してください。
        </p>
        {configStatus && (
          <ul className="schedule-view__config">
            {Object.entries(configStatus).map(([key, ok]) => (
              <li key={key}>
                {ok ? '✅' : '❌'} {key}
              </li>
            ))}
          </ul>
        )}
        <p className="schedule-view__hint">
          非相互フォローの整理機能は設定なしでこれまで通り使えます。
        </p>
      </div>
    )
  }

  if (!loggedIn) {
    return (
      <div className="schedule-view schedule-view--notice">
        <p>予約投稿を使うにはログインしてください。</p>
        <p className="schedule-view__hint">
          あなた以外がこのページからあなたのXアカウントに投稿できないようにするための確認です。
        </p>
        <button type="button" className="btn btn--primary" onClick={() => void signInWithGoogle()}>
          Googleでログイン
        </button>
      </div>
    )
  }

  function openCompose(post?: ScheduledPost) {
    setEditing(post)
    setSheetStartWithAi(false)
    setSheetOpen(true)
  }

  function closeSheetPane() {
    setSheetOpen(false)
    setEditing(undefined)
  }

  // かぶせて出している間に書いた本文は、保存するまでどこにも残らない。
  // 背景やEscで閉じるのは指が滑っただけのこともあるので、書きかけなら一度止める。
  function closeSheet() {
    if (isEditing() && !window.confirm('書きかけの投稿を破棄しますか？')) return
    closeSheetPane()
  }

  return (
    <div className="schedule-view">
      {callbackMessage && <p className="schedule-view__success">{callbackMessage}</p>}
      {callbackError && <p className="schedule-view__error">{callbackError}</p>}

      <XConnectCard account={xAccount} onChanged={() => void reload()} />

      <ScheduleSummaryBar summary={summary} />

      {!xAccount && summary.scheduled > 0 && (
        <p className="schedule-view__warning">
          Xと連携していないため、予約した投稿は実行されません。上の「Xと連携する」から接続してください。
        </p>
      )}

      <div className="schedule-view__toolbar">
        {/* 「新しい投稿」と「AIで投稿案を作る」は別々の入口だったが、
            AI支援はコンポーザーの中に入れて入口を1つにした。 */}
        <button type="button" className="btn btn--ghost" onClick={() => openCompose()}>
          <Icon name="plus" />
          投稿を作る
        </button>
        <div className="schedule-view__toolbar-end">
          <button type="button" className="btn btn--ghost btn--small" onClick={() => void reload()} aria-label="再読み込み">
            <Icon name="refresh" size={16} />
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => void signOut()} aria-label="ログアウト">
            <Icon name="logout" size={16} />
          </button>
        </div>
      </div>

      {sheetOpen && (
        <ComposerSheet
          editing={editing}
          onClose={closeSheet}
          onSaved={() => {
            closeSheetPane()
            void reload()
          }}
          onDraftsAdded={() => void reload()}
          startWithAiOpen={sheetStartWithAi}
        />
      )}

      {error && <p className="schedule-view__error">{error}</p>}
      {loading && posts.length === 0 ? (
        <p className="loading-indicator">予約を読み込んでいます…</p>
      ) : (
        <ScheduledPostList
          posts={posts}
          onChanged={() => void reload()}
          onEdit={(post) => openCompose(post)}
          onCompose={() => openCompose()}
        />
      )}
    </div>
  )
}
