import { useState } from 'react'
import { saveSettings, X_REPEAT_INTERVALS, type ChannelSnapshot } from '../../lib/autopost/api'
import { estimate, intervalLabel } from '../../lib/autopost/xRepeat'
import { formatYen } from '../../lib/xAutopilot/cost'

// X（くり返し）の投稿の間隔。X API は投稿1件ごとにお金がかかる（$0.015）ので、選ぶと同時に
// 1日の本数と月の目安を出す（間隔を縮めたら料金がどれだけ増えるかを、押す前に分かるように）。

const DEFAULT_INTERVAL = 60

interface Props {
  snapshot: ChannelSnapshot
  onChanged: (snapshot: ChannelSnapshot) => void
}

export function XRepeatInterval({ snapshot, onChanged }: Props) {
  const saved = snapshot.settings?.intervalMinutes ?? DEFAULT_INTERVAL
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { perDay, monthlyYen } = estimate(saved)

  async function change(minutes: number) {
    if (busy || minutes === saved) return
    setBusy(true)
    setError(undefined)
    try {
      onChanged(await saveSettings('xrepeat', { intervalMinutes: minutes }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="surface-card autopost__pause" aria-label="投稿の間隔">
      <div className="autopost__pause-text">
        <strong>投稿の間隔</strong>
        <span>
          {intervalLabel(saved)}・1日{perDay}本（終日投稿したとき）・X API の料金は月約{formatYen(monthlyYen)}
        </span>
        <span>文に URL を入れると、1件ごとの料金が約13倍（$0.20）になります。X と連携していないと投稿できません。</span>
        {error && (
          <span className="autopost__pause-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <select
        aria-label="投稿の間隔"
        value={saved}
        disabled={busy}
        onChange={(e) => void change(Number(e.target.value))}
      >
        {X_REPEAT_INTERVALS.map((m) => (
          <option key={m} value={m}>
            {intervalLabel(m)}（月約{formatYen(estimate(m).monthlyYen)}）
          </option>
        ))}
      </select>
    </section>
  )
}
