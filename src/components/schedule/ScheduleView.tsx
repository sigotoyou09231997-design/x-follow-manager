import { useEffect, useState } from 'react'
import { X_CALLBACK_PATH } from '../../lib/schedule/constants'
import { completeXConnect } from '../../lib/schedule/api'
import { signInWithGoogle, signOut, useSupabaseAuth } from '../../hooks/useSupabaseAuth'
import { useScheduledPosts } from '../../hooks/useScheduledPosts'
import type { PostSegment, ScheduledPost } from '../../lib/schedule/types'
import { Icon } from '../Icon'
import { AiGeneratePanel } from './AiGeneratePanel'
import { PostComposer } from './PostComposer'
import { ScheduledPostList } from './ScheduledPostList'
import { ScheduleSummaryBar } from './ScheduleSummaryBar'
import { XConnectCard } from './XConnectCard'

type Pane = 'none' | 'compose' | 'ai'

export function ScheduleView() {
  const { session, loading: authLoading, configured, configStatus } = useSupabaseAuth()
  const loggedIn = !!session
  const { posts, summary, xAccount, loading, error, reload } = useScheduledPosts(loggedIn)

  const [pane, setPane] = useState<Pane>('none')
  const [editing, setEditing] = useState<ScheduledPost>()
  const [seeded, setSeeded] = useState<PostSegment[]>()
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

  function openCompose(post?: ScheduledPost, segments?: PostSegment[]) {
    setEditing(post)
    setSeeded(segments)
    setPane('compose')
  }

  function closePane() {
    setPane('none')
    setEditing(undefined)
    setSeeded(undefined)
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
        <button
          type="button"
          className={pane === 'compose' ? 'btn btn--primary' : 'btn btn--ghost'}
          onClick={() => (pane === 'compose' ? closePane() : openCompose())}
        >
          <Icon name="plus" />
          新しい投稿
        </button>
        <button
          type="button"
          className={pane === 'ai' ? 'btn btn--primary' : 'btn btn--ghost'}
          onClick={() => (pane === 'ai' ? closePane() : setPane('ai'))}
        >
          <Icon name="sparkles" />
          AIで投稿案を作る
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
          initialSegments={seeded}
          onSaved={() => {
            closePane()
            void reload()
          }}
          onCancel={closePane}
        />
      )}

      {pane === 'ai' && (
        <AiGeneratePanel
          onSaved={() => {
            setPane('none')
            void reload()
          }}
          onEdit={(segments) => openCompose(undefined, segments)}
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
