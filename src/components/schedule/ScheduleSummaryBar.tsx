import type { ScheduleSummary } from '../../lib/schedule/types'

function formatNext(iso?: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const time = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `今日 ${time}`
  return `${date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })} ${time}`
}

/** 「今どれくらい予約してるか」を一目で見せるバー。 */
export function ScheduleSummaryBar({ summary }: { summary: ScheduleSummary }) {
  return (
    <div className="summary-bar summary-bar--schedule">
      <div className="summary-stat summary-stat--accent">
        <span className="summary-stat__value">{summary.scheduled.toLocaleString()}</span>
        <span className="summary-stat__label">予約中</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat__value">{summary.dueToday.toLocaleString()}</span>
        <span className="summary-stat__label">今日の予定</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat__value summary-stat__value--small">
          {formatNext(summary.nextScheduledAt)}
        </span>
        <span className="summary-stat__label">次の投稿</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat__value">{summary.draft.toLocaleString()}</span>
        <span className="summary-stat__label">下書き</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat__value">{summary.repeating.toLocaleString()}</span>
        <span className="summary-stat__label">繰り返し</span>
      </div>
      <div className="summary-stat">
        <span className="summary-stat__value">{summary.posted.toLocaleString()}</span>
        <span className="summary-stat__label">投稿済み</span>
      </div>
      <div className={summary.failed > 0 ? 'summary-stat summary-stat--danger' : 'summary-stat'}>
        <span className="summary-stat__value">{summary.failed.toLocaleString()}</span>
        <span className="summary-stat__label">失敗</span>
      </div>
    </div>
  )
}
