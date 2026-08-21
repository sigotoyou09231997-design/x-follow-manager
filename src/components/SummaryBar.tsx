import type { Summary } from '../hooks/useAccounts'

export function SummaryBar({ summary }: { summary: Summary }) {
  return (
    <div className="summary-bar">
      <div className="summary-stat">
        <span className="summary-stat__value">{summary.followingCount.toLocaleString()}</span>
        <span className="summary-stat__label">フォロー中</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat__value">{summary.followersCount.toLocaleString()}</span>
        <span className="summary-stat__label">フォロワー</span>
      </div>
      <div className="summary-stat summary-stat--accent">
        <span className="summary-stat__value">{summary.total.toLocaleString()}</span>
        <span className="summary-stat__label">非相互フォロー</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat__value">{summary.pending.toLocaleString()}</span>
        <span className="summary-stat__label">未処理</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat__value">{summary.done.toLocaleString()}</span>
        <span className="summary-stat__label">解除済み</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat__value">{summary.protected.toLocaleString()}</span>
        <span className="summary-stat__label">保護</span>
      </div>
    </div>
  )
}
