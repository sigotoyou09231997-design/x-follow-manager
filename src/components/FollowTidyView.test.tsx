import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FollowTidyView } from './FollowTidyView'
import type { AccountRecord } from '../lib/types'

function buildAccounts(count: number): AccountRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `k${i}`,
    accountId: String(i),
    username: `user${i}`,
    displayName: `ユーザー${i}`,
    profileUrl: `https://x.com/user${i}`,
    status: 'pending' as const,
    importedAt: 1767225600000,
    updatedAt: 1767225600000,
  }))
}

function renderView(accounts: AccountRecord[], selectedKey: string | null) {
  const view = render(
    <FollowTidyView
      accounts={accounts}
      overline="READY TO REVIEW"
      heading="見出し"
      filter="all"
      onFilterChange={() => {}}
      search=""
      onSearchChange={() => {}}
      selectedKey={selectedKey}
      onSelect={() => {}}
      batchAccounts={[]}
      batchSize={100}
      onBatchSizeChange={() => {}}
      onStartBatch={() => {}}
      pendingTotal={accounts.length}
      onOpenProfile={() => {}}
      onMarkDone={() => {}}
      onToggleProtect={() => {}}
    />
  )
  // 選択中の1件は右の確認パネルにも名前が出るので、一覧の中だけを見る。
  const list = view.container.querySelector('.account-table') as HTMLElement
  return within(list)
}

// 一覧は1ページ200件まで。選択はページの区切りと関係なく一覧全体を進むので、
// ページが追いかけないと「詳細には出ているのに一覧のどこにもいない」状態になる。
describe('FollowTidyView: 選択とページの追従', () => {
  it('2ページ目のアカウントを選ぶと、その行が出ているページを表示する', () => {
    const list = renderView(buildAccounts(400), 'k250')

    expect(list.getByText('ユーザー250')).toBeInTheDocument()
    expect(list.queryByText('ユーザー0')).not.toBeInTheDocument()
    expect(screen.getByText(/2 \/ 2 ページ/)).toBeInTheDocument()
  })

  it('1ページ目のアカウントを選んでいる間は1ページ目のまま', () => {
    const list = renderView(buildAccounts(400), 'k10')

    expect(list.getByText('ユーザー10')).toBeInTheDocument()
    expect(list.getByText('ユーザー0')).toBeInTheDocument()
    expect(screen.getByText(/1 \/ 2 ページ/)).toBeInTheDocument()
  })

  it('選択がないときは1ページ目から始まる', () => {
    renderView(buildAccounts(400), null)
    expect(screen.getByText(/1 \/ 2 ページ/)).toBeInTheDocument()
  })
})
