import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { relativeTime } from '../lib/relativeTime'
import type { AccountRecord } from '../lib/types'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

// 週の日付ストリップ。モックの装飾要素で、押しても何も起きない
// （「その日に確認した件数」を出す拡張余地として形だけ残している）。
function buildWeek(now: Date) {
  const start = new Date(now)
  start.setDate(now.getDate() - now.getDay())
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    return {
      key: date.toDateString(),
      weekday: WEEKDAY_LABELS[i],
      day: date.getDate(),
      today: date.toDateString() === now.toDateString(),
    }
  })
}

interface Props {
  account: AccountRecord
  /** 確認キュー内での位置（0始まり）と総数。モックの「12 / 100」に対応。 */
  index: number
  total: number
  hasNext: boolean
  showKeyboardHint?: boolean
  onOpenProfile: (account: AccountRecord) => void
  onToggleProtect: (account: AccountRecord) => void
  onMarkDone: (account: AccountRecord) => void
  onNext: () => void
  onClose?: () => void
}

export function AccountReviewPanel({
  account,
  index,
  total,
  hasNext,
  showKeyboardHint,
  onOpenProfile,
  onToggleProtect,
  onMarkDone,
  onNext,
  onClose,
}: Props) {
  const week = buildWeek(new Date())
  const name = account.displayName || account.username || account.accountId || '(不明なアカウント)'
  const handle = account.username ? `@${account.username}` : account.accountId ? `ID: ${account.accountId}` : ''

  return (
    <div className="review-panel">
      {onClose && (
        <button type="button" className="review-panel__close btn btn--icon" onClick={onClose} aria-label="閉じる">
          <Icon name="close" size={20} />
        </button>
      )}

      <div className="date-strip" aria-hidden="true">
        {week.map((d) => (
          <span key={d.key} className={`date-strip__day${d.today ? ' date-strip__day--today' : ''}`}>
            <span className="date-strip__weekday">{d.weekday}</span>
            <span className="date-strip__num tnum">{d.day}</span>
          </span>
        ))}
      </div>

      <div className="review-panel__head">
        <span className="overline">NOT FOLLOWING BACK</span>
        <span className="review-panel__progress tnum">
          {index + 1} / {total}
        </span>
      </div>

      <div className="review-panel__identity">
        <Avatar account={account} size={88} />
        <h3 className="review-panel__name">{name}</h3>
        {handle && <p className="review-panel__handle">{handle}</p>}
        <p className="review-panel__meta">
          <span className={`status-badge status-badge--${account.status}`}>
            {account.status === 'protected' ? '残す' : account.status === 'done' ? '解除済み' : '未確認'}
          </span>
          <span className="review-panel__stamp">{relativeTime(account.updatedAt || account.importedAt)}に更新</span>
        </p>
      </div>

      <div className="review-panel__actions">
        <button
          type="button"
          className={`btn btn--primary btn--block${account.status === 'protected' ? ' btn--on' : ''}`}
          onClick={() => onToggleProtect(account)}
        >
          <Icon name="bookmark" size={18} />
          {account.status === 'protected' ? '残すのを取り消す' : '残す'}
        </button>
        <button type="button" className="btn btn--secondary btn--block" onClick={onNext} disabled={!hasNext}>
          次へ
          <Icon name="arrow-right" size={18} />
        </button>
        <div className="review-panel__minor">
          <a
            className="btn btn--ghost btn--small"
            href={account.profileUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => onOpenProfile(account)}
          >
            <Icon name="external" size={16} />
            Xで開く
          </a>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            title="Xで実際にフォロー解除した後に押してください（自動検知はしません）"
            onClick={() => onMarkDone(account)}
          >
            {account.status === 'done' ? '解除済みを取り消す' : '解除済みにする'}
          </button>
        </div>
      </div>

      {showKeyboardHint && (
        <p className="review-panel__hint">Enter: Xで開く / D: 解除済み / P: 残す / ↑↓: 移動</p>
      )}
    </div>
  )
}
