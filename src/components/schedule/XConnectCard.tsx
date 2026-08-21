import { useState } from 'react'
import { disconnectX, startXConnect } from '../../lib/schedule/api'
import type { XAccountStatus } from '../../lib/schedule/types'

interface Props {
  account?: XAccountStatus
  onChanged: () => void
}

/** Xアカウントとの連携状態カード。連携していないと予約投稿は実行されない。 */
export function XConnectCard({ account, onChanged }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function handleConnect() {
    setBusy(true)
    setError(undefined)
    try {
      await startXConnect()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Xとの連携を解除します。予約済みの投稿は実行されなくなります。よろしいですか？')) {
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await disconnectX()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={account ? 'x-connect x-connect--linked' : 'x-connect'}>
      <div className="x-connect__body">
        <p className="x-connect__title">
          {account ? `@${account.username} と連携中` : 'Xアカウントと連携していません'}
        </p>
        <p className="x-connect__hint">
          {account
            ? '予約した時刻になると、このアカウントから自動で投稿されます。'
            : '連携すると、予約した時刻にブラウザを閉じていても自動で投稿されます。'}
        </p>
        {error && <p className="x-connect__error">{error}</p>}
      </div>
      {account ? (
        <button type="button" className="btn btn--ghost" onClick={handleDisconnect} disabled={busy}>
          連携を解除
        </button>
      ) : (
        <button type="button" className="btn btn--primary" onClick={handleConnect} disabled={busy}>
          {busy ? '接続中…' : 'Xと連携する'}
        </button>
      )}
    </div>
  )
}
