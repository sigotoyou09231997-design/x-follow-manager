import { useEffect, useState } from 'react'
import { X_CALLBACK_PATH } from '../../lib/schedule/constants'
import { completeXConnect } from '../../lib/schedule/api'
import { signInWithGoogle, signOut, useSupabaseAuth } from '../../hooks/useSupabaseAuth'
import { useScheduledPosts } from '../../hooks/useScheduledPosts'
import type { ScheduledPost } from '../../lib/schedule/types'
import { Icon } from '../Icon'
import { PostComposer } from './PostComposer'
import { ScheduledPostList } from './ScheduledPostList'
import { ScheduleSummaryBar } from './ScheduleSummaryBar'
import { XConnectCard } from './XConnectCard'

interface Props {
  /**
   * 増えるたびにコンポーザーを開く。モバイル下部バーの中央＋から渡ってくる。
   * boolean だと「開いて閉じてもう一度押す」が同じ値になって効かないため、
   * 押された回数をそのまま渡してもらう。
   */
  composeRequest?: number
}

type Pane = 'none' | 'compose'

export function ScheduleView({ composeRequest = 0 }: Props) {
  const { session, loading: authLoading, configured, configStatus } = useSupabaseAuth()
  const loggedIn = !!session
  const { posts, summary, xAccount, loading, error, reload } = useScheduledPosts(loggedIn)

  const [pane, setPane] = useState<Pane>('none')
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

  // 中央の＋から来たときは、そのまま新規作成のコンポーザーを開く。
  useEffect(() => {
    if (composeRequest <= 0) return
    setEditing(undefined)
    setPane('compose')
  }, [composeRequest])

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
    setPane('compose')
  }

  function closePane() {
    setPane('none')
    setEditing(undefined)
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
        <button
          type="button"
          className={pane === 'compose' ? 'btn btn--primary' : 'btn btn--ghost'}
          onClick={() => (pane === 'compose' ? closePane() : openCompose())}
        >
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

      {pane === 'compose' && (
        <PostComposer
          editing={editing}
          onSaved={() => {
            closePane()
            void reload()
          }}
          onCancel={closePane}
          onDraftsAdded={() => void reload()}
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
        />
      )}
    </div>
  )
}
