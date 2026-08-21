import type { ScheduleSummary } from '../../lib/schedule/types'

function formatNext(iso?: string): string {
  if (!iso) return 'なし'
  const date = new Date(iso)
  const now = new Date()
  const time = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === now.toDateString()) return `今日 ${time}`

  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (date.toDateString() === tomorrow.toDateString()) return `明日 ${time}`

  return `${date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })} ${time}`
}

/**
 * 「今どれくらい予約してるか」を見せる。
 * 一番知りたい予約中の件数と次の投稿時刻だけを大きく出し、
 * 残りは同じ重みの小さなマス目に落とす。狭い画面でも上段だけ読めば用が足りる。
 */
export function ScheduleSummaryBar({ summary }: { summary: ScheduleSummary }) {
  const stats = [
    { label: '今日', value: summary.dueToday },
    { label: '下書き', value: summary.draft },
    { label: '繰り返し', value: summary.repeating },
    { label: '投稿済み', value: summary.posted },
    { label: '失敗', value: summary.failed, danger: true },
  ]

  return (
    <div className="stat-strip">
      <div className="stat-hero">
        <div className="stat-hero__main">
          <span className="stat-hero__value">{summary.scheduled.toLocaleString()}</span>
          <span className="stat-hero__label">件を予約中</span>
        </div>
        <div className="stat-hero__next">
          <span className="stat-hero__next-label">次の投稿</span>
          <span className="stat-hero__next-value">{formatNext(summary.nextScheduledAt)}</span>
        </div>
      </div>

      <div className="stat-grid">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={stat.danger && stat.value > 0 ? 'stat stat--danger' : 'stat'}
          >
            <span className="stat__value">{stat.value.toLocaleString()}</span>
            <span className="stat__label">{stat.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
