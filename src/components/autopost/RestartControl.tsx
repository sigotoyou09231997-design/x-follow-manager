import { useState } from 'react'
import { useRestart } from '../../hooks/useRestart'

interface Props {
  enabled: boolean
  /** どれかの投稿先で、Mac からの報告が途絶えているか。そうなら「止まっているかも」と強めに出す。 */
  silent: boolean
}

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

/**
 * 「投稿役を再起動する」。止まったときの通知（api/_lib/posterWatch.ts）からここへ来て、押す。
 * 押すと依頼が置かれ、Mac の見張り（poster/remote/）が1分ごとに見に来て、止まっている投稿役だけを入れ替える
 * （動いているものには触らない）。Mac 本体は再起動しない。
 * 押し間違いで動いている投稿役を巻き込まないよう、押したあとにもう一度確かめる。
 */
export function RestartControl({ enabled, silent }: Props) {
  const { restart, busy, error, request } = useRestart(enabled)
  const [confirming, setConfirming] = useState(false)

  if (!restart) return null

  if (!restart.ready) {
    return (
      <section className="surface-card autopost__pause" aria-label="投稿役の再起動">
        <div className="autopost__pause-text">
          <strong>再起動の機能は準備中です</strong>
          <span>Supabase の SQL Editor で supabase/sql/008_autopost_restart.sql を実行すると使えます。</span>
        </div>
      </section>
    )
  }

  const pending = !!restart.requestedAt && !restart.handledAt
  const handled = !!restart.requestedAt && !!restart.handledAt

  const title = pending
    ? '再起動を依頼しました'
    : silent
      ? '投稿役が止まっているかもしれません'
      : '投稿役を再起動する'
  const detail = pending
    ? 'Mac が1分以内に受け取って、止まっている投稿役を入れ替えます。このまま待てます。'
    : handled && restart.handledAt
      ? `${timeOf(restart.handledAt)} に処理されました。${restart.result ?? ''}`
      : '止まっている投稿役（Yay・ディスコード）だけを Mac で入れ替えます。動いているものには触りません。Mac 本体は再起動しません。'

  async function onConfirm() {
    setConfirming(false)
    await request()
  }

  return (
    <section
      className={`surface-card autopost__pause${silent || pending ? ' autopost__pause--pausing' : ''}`}
      aria-label="投稿役の再起動"
    >
      <div className="autopost__pause-text">
        <strong>{title}</strong>
        <span>{detail}</span>
        {error && (
          <span className="autopost__pause-error" role="alert">
            {error}
          </span>
        )}
      </div>
      {confirming ? (
        <div className="autopost__restart-actions">
          <button type="button" className="btn btn--primary" onClick={() => void onConfirm()} disabled={busy}>
            再起動する
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => setConfirming(false)}>
            やめる
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`btn ${silent ? 'btn--primary' : 'btn--secondary'}`}
          onClick={() => setConfirming(true)}
          disabled={busy || pending}
        >
          {busy ? '送っています…' : pending ? '依頼中…' : '投稿役を再起動する'}
        </button>
      )}
    </section>
  )
}
