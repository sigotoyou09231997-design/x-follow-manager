import { HistoryView } from './HistoryView'
import { Icon } from './Icon'
import { SummaryBar } from './SummaryBar'
import type { Summary } from '../hooks/useAccounts'
import type { AccountRecord } from '../lib/types'

interface Props {
  summary: Summary
  accounts: AccountRecord[]
  /** 直近の作業バッチ。永続化されている currentBatchKeys から復元したもの。 */
  batchAccounts: AccountRecord[]
  batchSize: number
  onSearchFocus: () => void
  onGotoPending: () => void
  onGotoProtected: () => void
  /** 未確認の確認作業を始める / 途中のバッチを再開する。 */
  onReview: () => void
}

export function HomeView({
  summary,
  accounts,
  batchAccounts,
  batchSize,
  onSearchFocus,
  onGotoPending,
  onGotoProtected,
  onReview,
}: Props) {
  const doneInBatch = batchAccounts.filter((a) => a.status !== 'pending').length
  const remainingInBatch = batchAccounts.length - doneInBatch
  const hasData = summary.total > 0

  return (
    <div className="home-view">
      <button type="button" className="home-search" onClick={onSearchFocus}>
        <Icon name="search" size={18} />
        <span>アカウントを検索</span>
      </button>

      <section className="home-section">
        <h2 className="home-section__title">フォロー整理</h2>
        <div className="home-cards">
          <button type="button" className="entry-card" onClick={onGotoPending}>
            <span className="entry-card__value tnum">{summary.pending.toLocaleString()}</span>
            <span className="entry-card__label">未確認</span>
            <span className="entry-card__desc">非相互フォローを整理</span>
            <Icon name="chevron-right" size={18} className="entry-card__chevron" />
          </button>
          <button type="button" className="entry-card" onClick={onGotoProtected}>
            <span className="entry-card__value tnum">{summary.protected.toLocaleString()}</span>
            <span className="entry-card__label">残す</span>
            <span className="entry-card__desc">あとで見直す</span>
            <Icon name="chevron-right" size={18} className="entry-card__chevron" />
          </button>
        </div>
      </section>

      <section className="home-section">
        <h2 className="home-section__title">今日のタスク</h2>
        <ul className="task-list">
          <li className={`task-item${hasData ? ' task-item--done' : ''}`}>
            <span className="task-item__check" aria-hidden="true">
              {hasData && <Icon name="check" size={14} />}
            </span>
            <span className="task-item__body">
              <span className="task-item__label">アーカイブを読み込む</span>
              <span className="task-item__meta">{hasData ? '端末内で解析済み' : 'まだ読み込んでいません'}</span>
            </span>
          </li>
          <li className={`task-item${batchAccounts.length > 0 && remainingInBatch === 0 ? ' task-item--done' : ''}`}>
            <span className="task-item__check" aria-hidden="true">
              {batchAccounts.length > 0 && remainingInBatch === 0 && <Icon name="check" size={14} />}
            </span>
            <span className="task-item__body">
              <span className="task-item__label">
                {batchAccounts.length > 0 ? `${batchAccounts.length}人を確認する` : `${batchSize}人を確認する`}
              </span>
              <span className="task-item__meta">
                {batchAccounts.length > 0
                  ? remainingInBatch > 0
                    ? `残り${remainingInBatch}人`
                    : 'このバッチは完了しました'
                  : `未確認${summary.pending.toLocaleString()}人から次のバッチを始めましょう`}
              </span>
            </span>
            {/* 進行中でも押せるようにしておく。中央の＋が予約投稿になったぶん、
                モバイルで「続きから再開する」入口はここが担う。 */}
            <button type="button" className="btn btn--primary btn--small" onClick={onReview}>
              {remainingInBatch > 0 ? '続きから' : '開始'}
            </button>
          </li>
        </ul>
      </section>

      <SummaryBar summary={summary} />

      <HistoryView accounts={accounts} limit={5} heading="最近のうごき" overline="RECENT" />
    </div>
  )
}
