import { useCallback, useEffect, useState } from 'react'
import {
  disablePush,
  enablePush,
  getPushSubscription,
  isPushConfigured,
  isPushSupported,
} from '../lib/push'
import { useSupabaseAuth } from '../hooks/useSupabaseAuth'
import { Icon } from './Icon'

/**
 * 「アプリが更新されたら端末に通知する」の設定。
 *
 * 画面上部の更新バナーはタブを開いている間しか効かないので、閉じているあいだの
 * 更新に気づくにはこちらが要る。購読情報を本人の行として保存するためログインが必要。
 */
export function PushSettings() {
  const { session, configured } = useSupabaseAuth()
  const [available, setAvailable] = useState<boolean>()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()

  const supported = isPushSupported()

  const refresh = useCallback(async () => {
    setAvailable(await isPushConfigured())
    setEnabled(!!(await getPushSubscription()))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function toggle() {
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      if (enabled) {
        await disablePush()
        setMessage('この端末への通知を止めました')
      } else {
        await enablePush()
        setMessage('この端末で通知を受け取ります')
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // 接続情報すら取れない環境（ローカルの `npm run dev` など）では出しても操作できない。
  if (!configured) return null

  return (
    <section className="settings-section">
      <h2>
        <span className="settings-section__icon">
          <Icon name="bell" size={16} />
        </span>
        アップデートの通知
      </h2>
      <p className="settings-section__desc">
        アプリが新しくなったとき、この端末へ通知します。
        画面を開いているときは上部に帯が出て自動で最新版に切り替わるので、こちらは
        アプリを閉じているあいだの更新に気づくためのものです。
      </p>

      {!supported ? (
        <p className="settings-section__meta">
          この端末・ブラウザは通知に対応していません。
          iPhoneの場合は、ホーム画面に追加したアプリとして開くと使えるようになります。
        </p>
      ) : available === false ? (
        <p className="settings-section__meta">
          サーバー側の通知設定（VAPIDの鍵）がまだ入っていません。README の「アップデート通知」を参照してください。
        </p>
      ) : !session ? (
        <p className="settings-section__meta">
          通知を使うにはログインが必要です。「予約投稿」タブからGoogleでログインしてください。
        </p>
      ) : (
        <>
          <button
            type="button"
            className={enabled ? 'btn btn--ghost' : 'btn btn--primary'}
            onClick={() => void toggle()}
            disabled={busy || available === undefined}
          >
            <Icon name={enabled ? 'close' : 'bell'} size={16} />
            {busy ? '設定中…' : enabled ? 'この端末への通知を止める' : 'この端末で通知を受け取る'}
          </button>
          {message && <p className="settings-section__meta">{message}</p>}
        </>
      )}

      {error && <p className="settings-section__error">{error}</p>}
    </section>
  )
}
