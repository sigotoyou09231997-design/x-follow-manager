import { useEffect, useMemo, useState, type RefObject } from 'react'
import { AccountRow } from './AccountRow'
import { AccountReviewPanel } from './AccountReviewPanel'
import { Icon } from './Icon'
import { downloadCsv } from '#csv'
import type { AccountRecord, AccountStatus } from '../lib/types'

export type FilterKey = 'all' | AccountStatus

// モックの3タブ構成。done（解除済み）は「履歴」画面に回すのでここには出さない。
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'pending', label: '未確認' },
  { key: 'protected', label: '残す' },
]

const BATCH_SIZES = [10, 50, 100] as const
const PAGE_SIZE = 200

interface Props {
  accounts: AccountRecord[]
  overline: string
  heading: string
  filter: FilterKey
  onFilterChange: (filter: FilterKey) => void
  /** 「残すリスト」のようにフィルタを固定する画面ではタブを隠す。 */
  showFilters?: boolean
  search: string
  onSearchChange: (value: string) => void
  searchRef?: RefObject<HTMLInputElement | null>
  selectedKey: string | null
  onSelect: (key: string | null) => void
  batchAccounts: AccountRecord[]
  batchSize: number
  onBatchSizeChange: (size: number) => void
  onStartBatch: () => void
  pendingTotal: number
  onOpenProfile: (account: AccountRecord) => void
  onMarkDone: (account: AccountRecord) => void
  onToggleProtect: (account: AccountRecord) => void
}

export function FollowTidyView({
  accounts,
  overline,
  heading,
  filter,
  onFilterChange,
  showFilters = true,
  search,
  onSearchChange,
  searchRef,
  selectedKey,
  onSelect,
  batchAccounts,
  batchSize,
  onBatchSizeChange,
  onStartBatch,
  pendingTotal,
  onOpenProfile,
  onMarkDone,
  onToggleProtect,
}: Props) {
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return accounts.filter((account) => {
      if (filter !== 'all' && account.status !== filter) return false
      if (!query) return true
      return (
        account.username?.toLowerCase().includes(query) ||
        account.displayName?.toLowerCase().includes(query) ||
        account.accountId?.includes(query)
      )
    })
  }, [accounts, filter, search])

  useEffect(() => {
    setPage(0)
  }, [filter, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageItems = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)

  // 作業中のバッチに含まれる1件を見ているあいだは、バッチが確認キューになる。
  // それ以外（一覧から任意の1件を開いたとき）は、いま見えている一覧がキュー。
  const inBatch = batchAccounts.some((a) => a.key === selectedKey)
  const queue = inBatch ? batchAccounts : filtered
  const currentIndex = queue.findIndex((a) => a.key === selectedKey)
  const selected = currentIndex >= 0 ? queue[currentIndex] : null
  const hasNext = currentIndex >= 0 && currentIndex < queue.length - 1

  const doneInBatch = batchAccounts.filter((a) => a.status !== 'pending').length
  const batchFocusIndex = batchAccounts.findIndex((a) => a.key === selectedKey)

  function advance() {
    const next = queue[currentIndex + 1]
    if (next) onSelect(next.key)
  }

  // 状態を変えると対象がフィルタから外れて消えることがあるので、
  // 変更を投げる前に次の選択先を決めておく。
  function nextAfterMutation(): string | null {
    return queue[currentIndex + 1]?.key ?? queue[currentIndex - 1]?.key ?? null
  }

  function handleMarkDone(account: AccountRecord) {
    const next = nextAfterMutation()
    onMarkDone(account)
    onSelect(next)
  }

  function handleToggleProtect(account: AccountRecord) {
    const next = nextAfterMutation()
    onToggleProtect(account)
    onSelect(next)
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (!selected) return

      switch (event.key) {
        case 'Enter':
          event.preventDefault()
          window.open(selected.profileUrl, '_blank', 'noopener,noreferrer')
          onOpenProfile(selected)
          break
        case 'd':
        case 'D':
          event.preventDefault()
          handleMarkDone(selected)
          break
        case 'p':
        case 'P':
          event.preventDefault()
          handleToggleProtect(selected)
          break
        case 'ArrowDown':
        case 'j':
          event.preventDefault()
          advance()
          break
        case 'ArrowUp':
        case 'k': {
          event.preventDefault()
          const prev = queue[currentIndex - 1]
          if (prev) onSelect(prev.key)
          break
        }
        case 'Escape':
          onSelect(null)
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, currentIndex, selected])

  return (
    <div className={`tidy-view${selected ? ' tidy-view--detail-open' : ''}`}>
      <header className="view-head">
        <span className="overline">{overline}</span>
        <h2 className="view-head__title">{heading}</h2>
      </header>

      <input
        ref={searchRef}
        className="tidy-view__search"
        type="search"
        placeholder="ユーザー名・表示名で検索"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      <div className="tidy-toolbar">
        {showFilters && (
          <div className="filter-bar__tabs">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`filter-tab${filter === f.key ? ' filter-tab--active' : ''}`}
                onClick={() => onFilterChange(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <div className="tidy-toolbar__end">
          <div className="batch-controls__size">
            {BATCH_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={`filter-tab filter-tab--quiet${batchSize === size ? ' filter-tab--active' : ''}`}
                onClick={() => onBatchSizeChange(size)}
              >
                {size}
              </button>
            ))}
            <button type="button" className="btn btn--small btn--secondary" onClick={onStartBatch} disabled={pendingTotal === 0}>
              次の{batchSize}人を選択
            </button>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={filtered.length === 0}
            onClick={() => downloadCsv(`x-non-mutual-${filter}.csv`, filtered)}
          >
            <Icon name="download" size={16} />
            CSV書き出し（{filtered.length}件）
          </button>
        </div>
      </div>

      {batchAccounts.length > 0 && (
        <div className="batch-progress">
          <div className="batch-progress__bar">
            <div
              className="batch-progress__fill"
              style={{ width: `${(doneInBatch / batchAccounts.length) * 100}%` }}
            />
          </div>
          <span className="tnum">
            今回の作業 {doneInBatch} / {batchAccounts.length} 完了
          </span>
        </div>
      )}

      <div className="tidy-layout">
        <div className="tidy-layout__list">
          {filtered.length === 0 ? (
            <p className="empty-state">
              {filter === 'pending' && !search.trim()
                ? '未確認のアカウントはありません。すべて確認済みです。'
                : '該当するアカウントがありません'}
            </p>
          ) : (
            <>
              <div className="account-table">
                {pageItems.map((account) => (
                  <AccountRow
                    key={account.key}
                    account={account}
                    selected={account.key === selectedKey}
                    focused={inBatch && account.key === selectedKey}
                    onSelect={(a) => onSelect(a.key)}
                  />
                ))}
              </div>
              {pageCount > 1 && (
                <div className="pagination">
                  <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                    前へ
                  </button>
                  <span className="tnum">
                    {currentPage + 1} / {pageCount} ページ（{filtered.length.toLocaleString()}件）
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    次へ
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="tidy-layout__detail">
          {selected ? (
            <AccountReviewPanel
              account={selected}
              index={inBatch && batchFocusIndex >= 0 ? batchFocusIndex : currentIndex}
              total={queue.length}
              hasNext={hasNext}
              showKeyboardHint
              onOpenProfile={onOpenProfile}
              onToggleProtect={handleToggleProtect}
              onMarkDone={handleMarkDone}
              onNext={advance}
              onClose={() => onSelect(null)}
            />
          ) : (
            <div className="review-placeholder">
              <Icon name="tasks" size={28} />
              <p>リストから1件選ぶと、ここで確認できます。</p>
              <p className="review-placeholder__hint">
                「次の{batchSize}人を選択」を押すと、未確認のアカウントからまとめて確認できます。
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
