import { useEffect, useRef } from 'react'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { relativeTime } from '../lib/relativeTime'
import type { AccountRecord } from '../lib/types'

const STATUS_LABEL: Record<AccountRecord['status'], string> = {
  pending: '未確認',
  done: '解除済み',
  protected: '残す',
  skipped: 'スキップ',
}

interface Props {
  account: AccountRecord
  /** 詳細パネルに出ている1件。PCでは選択行、モバイルでは直前に開いた行。 */
  selected?: boolean
  /** バッチ内の作業対象としてフォーカスが当たっている行。 */
  focused?: boolean
  onSelect: (account: AccountRecord) => void
}

export function AccountRow({ account, selected, focused, onSelect }: Props) {
  const name = account.displayName || account.username || account.accountId || '(不明なアカウント)'
  const handle = account.username ? `@${account.username}` : account.accountId ? `ID: ${account.accountId}` : ''
  const stamp = relativeTime(account.updatedAt || account.importedAt)
  const ref = useRef<HTMLButtonElement>(null)

  // キーボードや「次へ」で選択が進むと、次の1件は画面の外にあることが多い。
  // 'nearest' なので、すでに見えている行（＝自分でクリックした行）では動かない。
  useEffect(() => {
    if (!selected) return
    ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      className={`account-row${selected ? ' account-row--selected' : ''}${focused ? ' account-row--focused' : ''}`}
      onClick={() => onSelect(account)}
      aria-current={selected ? 'true' : undefined}
    >
      <Avatar account={account} size={44} />
      <span className="account-row__identity">
        <span className="account-row__name">{name}</span>
        {handle && <span className="account-row__sub">{handle}</span>}
      </span>
      {account.status !== 'pending' && (
        <span className={`status-badge status-badge--${account.status}`}>{STATUS_LABEL[account.status]}</span>
      )}
      <span className="account-row__time tnum">{stamp}</span>
      <Icon name="chevron-right" size={18} className="account-row__chevron" />
    </button>
  )
}
