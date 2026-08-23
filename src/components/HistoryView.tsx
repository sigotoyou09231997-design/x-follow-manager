import { useMemo } from 'react'
import { Avatar } from './Avatar'
import { relativeTime } from '../lib/relativeTime'
import type { AccountRecord } from '../lib/types'

interface Props {
  accounts: AccountRecord[]
  /** ホーム画面に差し込むときは件数を絞る。 */
  limit?: number
  heading?: string
  overline?: string
}

// 「残す」「解除済み」にしたアカウントを、既存の protectedAt / completedAt だけで
// 時系列に並べる。新しい保存項目は増やさない。
export function HistoryView({ accounts, limit, heading = '履歴', overline = 'TIMELINE' }: Props) {
  const items = useMemo(() => {
    const rows = accounts
      .filter((a) => a.status === 'done' || a.status === 'protected')
      .map((account) => ({
        account,
        at: (account.status === 'done' ? account.completedAt : account.protectedAt) ?? account.updatedAt,
      }))
      .sort((a, b) => b.at - a.at)
    return limit ? rows.slice(0, limit) : rows
  }, [accounts, limit])

  return (
    <section className="history-view">
      <header className="view-head">
        <span className="overline">{overline}</span>
        <h2 className="view-head__title">{heading}</h2>
      </header>

      {items.length === 0 ? (
        <p className="empty-state">まだ記録がありません。確認した結果がここに並びます。</p>
      ) : (
        <ol className="timeline">
          {items.map(({ account, at }) => (
            <li key={account.key} className={`timeline__item timeline__item--${account.status}`}>
              <span className="timeline__dot" aria-hidden="true" />
              <span className="timeline__when tnum">{relativeTime(at)}</span>
              <span className="timeline__body">
                <Avatar account={account} size={36} />
                <span className="timeline__identity">
                  <span className="timeline__name">
                    {account.displayName || account.username || account.accountId || '(不明なアカウント)'}
                  </span>
                  {account.username && <span className="timeline__handle">@{account.username}</span>}
                </span>
                <span className={`status-badge status-badge--${account.status}`}>
                  {account.status === 'done' ? '解除済み' : '残す'}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
