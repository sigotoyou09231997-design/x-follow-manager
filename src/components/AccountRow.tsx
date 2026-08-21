import type { AccountRecord } from '../lib/types'

const STATUS_LABEL: Record<AccountRecord['status'], string> = {
  pending: '未処理',
  done: '解除済み',
  protected: '保護',
  skipped: 'スキップ',
}

interface Props {
  account: AccountRecord
  focused?: boolean
  onOpenProfile: (account: AccountRecord) => void
  onMarkDone: (account: AccountRecord) => void
  onToggleProtect: (account: AccountRecord) => void
  onFocus?: (account: AccountRecord) => void
}

export function AccountRow({ account, focused, onOpenProfile, onMarkDone, onToggleProtect, onFocus }: Props) {
  const label = account.displayName || (account.username ? `@${account.username}` : null)
  const subLabel = account.username && account.displayName ? `@${account.username}` : account.accountId ? `ID: ${account.accountId}` : null

  return (
    <div
      className={`account-row${focused ? ' account-row--focused' : ''}`}
      onClick={() => onFocus?.(account)}
    >
      <div className="account-row__identity">
        <span className="account-row__name">{label ?? subLabel ?? '(不明なアカウント)'}</span>
        {label && subLabel && <span className="account-row__sub">{subLabel}</span>}
      </div>
      <span className={`status-badge status-badge--${account.status}`}>{STATUS_LABEL[account.status]}</span>
      <div className="account-row__actions">
        <a
          className="btn btn--secondary"
          href={account.profileUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => {
            e.stopPropagation()
            onOpenProfile(account)
          }}
        >
          Xで開く
        </a>
        <button
          type="button"
          className="btn btn--primary"
          disabled={account.status === 'done'}
          title="Xで実際にフォロー解除した後に押してください（自動検知はしません）"
          onClick={(e) => {
            e.stopPropagation()
            onMarkDone(account)
          }}
        >
          解除済みにする
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={(e) => {
            e.stopPropagation()
            onToggleProtect(account)
          }}
        >
          {account.status === 'protected' ? '保護を解除' : '保護'}
        </button>
      </div>
    </div>
  )
}
