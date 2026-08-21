import { useMemo, useState } from 'react'
import { AccountRow } from './AccountRow'
import { downloadCsv } from '#csv'
import type { AccountRecord, AccountStatus } from '../lib/types'

type FilterKey = 'all' | AccountStatus

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'pending', label: '未処理' },
  { key: 'done', label: '解除済み' },
  { key: 'protected', label: '保護' },
]

const PAGE_SIZE = 200

interface Props {
  accounts: AccountRecord[]
  onOpenProfile: (account: AccountRecord) => void
  onMarkDone: (account: AccountRecord) => void
  onToggleProtect: (account: AccountRecord) => void
}

export function AccountListView({ accounts, onOpenProfile, onMarkDone, onToggleProtect }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageItems = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)

  function updateFilter(next: FilterKey) {
    setFilter(next)
    setPage(0)
  }

  function updateSearch(value: string) {
    setSearch(value)
    setPage(0)
  }

  return (
    <div className="list-view">
      <div className="filter-bar">
        <div className="filter-bar__tabs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`filter-tab${filter === f.key ? ' filter-tab--active' : ''}`}
              onClick={() => updateFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="filter-bar__search"
          type="search"
          placeholder="ユーザー名・表示名で検索"
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
        />
        <button
          type="button"
          className="btn btn--secondary"
          disabled={filtered.length === 0}
          onClick={() => downloadCsv(`x-non-mutual-${filter}.csv`, filtered)}
        >
          CSV書き出し（{filtered.length}件）
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">該当するアカウントがありません</p>
      ) : (
        <>
          <div className="account-table">
            {pageItems.map((account) => (
              <AccountRow
                key={account.key}
                account={account}
                onOpenProfile={onOpenProfile}
                onMarkDone={onMarkDone}
                onToggleProtect={onToggleProtect}
              />
            ))}
          </div>
          {pageCount > 1 && (
            <div className="pagination">
              <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                前へ
              </button>
              <span>
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
  )
}
