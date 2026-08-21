import { useEffect, useMemo, useState } from 'react'
import { AccountRow } from './AccountRow'
import { META_KEYS, getNextBatchKeys, setMeta } from '#store'
import { useCurrentBatchKeys } from '#accounts-hook'
import type { AccountRecord } from '../lib/types'

const BATCH_SIZES = [10, 50, 100] as const

interface Props {
  accounts: AccountRecord[]
  onOpenProfile: (account: AccountRecord) => void
  onMarkDone: (account: AccountRecord) => void
  onToggleProtect: (account: AccountRecord) => void
}

export function BatchWorkView({ accounts, onOpenProfile, onMarkDone, onToggleProtect }: Props) {
  const [batchSize, setBatchSize] = useState<number>(100)
  const [focusIndex, setFocusIndex] = useState(0)

  const batchKeys = useCurrentBatchKeys()

  const accountsByKey = useMemo(() => new Map(accounts.map((a) => [a.key, a])), [accounts])
  const batchAccounts = useMemo(
    () => batchKeys.map((key) => accountsByKey.get(key)).filter((a): a is AccountRecord => !!a),
    [batchKeys, accountsByKey]
  )

  const pendingTotal = useMemo(() => accounts.filter((a) => a.status === 'pending').length, [accounts])
  const doneInBatch = batchAccounts.filter((a) => a.status !== 'pending').length

  useEffect(() => {
    setFocusIndex((i) => Math.min(i, Math.max(0, batchAccounts.length - 1)))
  }, [batchAccounts.length])

  async function selectNextBatch() {
    const keys = await getNextBatchKeys(batchSize)
    await setMeta(META_KEYS.currentBatchKeys, keys)
    setFocusIndex(0)
  }

  function advanceFocus() {
    setFocusIndex((i) => Math.min(i + 1, Math.max(0, batchAccounts.length - 1)))
  }

  function handleMarkDone(account: AccountRecord) {
    onMarkDone(account)
    advanceFocus()
  }

  function handleToggleProtect(account: AccountRecord) {
    onToggleProtect(account)
    advanceFocus()
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (batchAccounts.length === 0) return
      const focused = batchAccounts[focusIndex]
      if (!focused) return

      switch (event.key) {
        case 'Enter':
          event.preventDefault()
          window.open(focused.profileUrl, '_blank', 'noopener,noreferrer')
          onOpenProfile(focused)
          break
        case 'd':
        case 'D':
          event.preventDefault()
          handleMarkDone(focused)
          break
        case 'p':
        case 'P':
          event.preventDefault()
          handleToggleProtect(focused)
          break
        case 'ArrowDown':
        case 'j':
          event.preventDefault()
          setFocusIndex((i) => Math.min(i + 1, batchAccounts.length - 1))
          break
        case 'ArrowUp':
        case 'k':
          event.preventDefault()
          setFocusIndex((i) => Math.max(i - 1, 0))
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchAccounts, focusIndex])

  return (
    <div className="batch-view">
      <div className="batch-controls">
        <div className="batch-controls__size">
          <span>バッチサイズ</span>
          {BATCH_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={`filter-tab${batchSize === size ? ' filter-tab--active' : ''}`}
              onClick={() => setBatchSize(size)}
            >
              {size}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--primary" onClick={selectNextBatch} disabled={pendingTotal === 0}>
          次の{batchSize}人を選択
        </button>
        <span className="batch-controls__hint">未処理の残り: {pendingTotal.toLocaleString()}人</span>
      </div>

      {batchAccounts.length === 0 ? (
        <p className="empty-state">
          {pendingTotal === 0
            ? 'すべての非相互フォローが処理済みです'
            : `「次の${batchSize}人を選択」を押して作業を開始してください`}
        </p>
      ) : (
        <>
          <div className="batch-progress">
            <div className="batch-progress__bar">
              <div
                className="batch-progress__fill"
                style={{ width: `${(doneInBatch / batchAccounts.length) * 100}%` }}
              />
            </div>
            <span>
              今回の作業 {doneInBatch} / {batchAccounts.length} 完了
            </span>
            <span className="batch-controls__hint">Enter: Xで開く / D: 解除済み / P: 保護 / ↑↓: 移動</span>
          </div>
          <div className="account-table">
            {batchAccounts.map((account, index) => (
              <AccountRow
                key={account.key}
                account={account}
                focused={index === focusIndex}
                onFocus={() => setFocusIndex(index)}
                onOpenProfile={onOpenProfile}
                onMarkDone={handleMarkDone}
                onToggleProtect={handleToggleProtect}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
