import { useState } from 'react'
import type { ChannelSnapshot } from '../../lib/autopost/api'
import { startXConnect } from '../../lib/schedule/api'

// X（くり返し）が投稿する X アカウント。本アカウント（予約投稿・自動運転の連携）とは別に連携する。
// 2026-11-25、X（くり返し）が本アカウントに投稿してしまった。どのアカウントに出るかを、いつも画面の上で見せ、
// 専用の連携が無いあいだは投稿しないことをはっきり書く。

interface Props {
  snapshot: ChannelSnapshot
}

export function XRepeatAccount({ snapshot }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const account = snapshot.account ?? null

  async function connect() {
    setBusy(true)
    setError(undefined)
    try {
      await startXConnect('xrepeat') // X の許可画面へ移る（戻ってくるまで、この画面には戻らない）
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <section
      className={`surface-card autopost__pause${account ? '' : ' autopost__pause--pausing'}`}
      aria-label="投稿するアカウント"
    >
      <div className="autopost__pause-text">
        <strong>{account ? `投稿するアカウント：@${account.username}` : '投稿するアカウントがまだありません'}</strong>
        <span>
          {account
            ? '本アカウント（予約投稿・自動運転）とは別の連携です。変えるときは、X で投稿したいアカウントに切り替えてから「連携し直す」を押してください。'
            : '連携するまで投稿しません。X で投稿したいアカウントに切り替えてから押してください（本アカウントは連携できません）。'}
        </span>
        {error && (
          <span className="autopost__pause-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={() => void connect()}>
        {account ? '連携し直す' : '投稿するアカウントを連携'}
      </button>
    </section>
  )
}
