import type { Summary } from '../hooks/useAccounts'

const STATS: { key: keyof Summary; label: string; accent?: boolean }[] = [
  { key: 'followingCount', label: 'フォロー中' },
  { key: 'followersCount', label: 'フォロワー' },
  { key: 'total', label: '非相互', accent: true },
  { key: 'pending', label: '未確認' },
  { key: 'done', label: '解除済み' },
  { key: 'protected', label: '残す' },
]

export function SummaryBar({ summary }: { summary: Summary }) {
  return (
    <div className="summary-bar">
      {STATS.map((stat) => (
        <div key={stat.key} className={`summary-stat${stat.accent ? ' summary-stat--accent' : ''}`}>
          <span className="summary-stat__value tnum">{((summary[stat.key] as number) ?? 0).toLocaleString()}</span>
          <span className="summary-stat__label">{stat.label}</span>
        </div>
      ))}
    </div>
  )
}
