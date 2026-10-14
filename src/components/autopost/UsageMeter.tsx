import { formatYen } from '../../lib/xAutopilot/cost'
import type { AutopilotUsage } from '../../lib/xAutopilot/types'

interface Props {
  usage: AutopilotUsage
  /** 1か月に使ってよい金額の目安（円）。 */
  budgetYen: number
}

/** 上限に対する使った割合（0〜100。上限が0以下なら0）。 */
export function usagePercent(yen: number, budgetYen: number): number {
  if (!(budgetYen > 0)) return 0
  return Math.min(100, Math.max(0, Math.round((yen / budgetYen) * 100)))
}

/**
 * 今月、AI（文を作る・文体をまとめる）と X への投稿に、いくら使ったか。上限に対する割合を、棒でひと目で見せる。
 * 見積もり（実際の請求とは少しずれる）。上限に近づくと新しい投稿を作らなくなるので、8割を超えたら色を変えて知らせる。
 */
export function UsageMeter({ usage, budgetYen }: Props) {
  const percent = usagePercent(usage.yen, budgetYen)
  const level = percent >= 100 ? 'over' : percent >= 80 ? 'warn' : 'ok'
  const month = usage.month ? `${Number(usage.month.slice(5, 7))}月` : '今月'

  return (
    <section className={`surface-card usage-meter usage-meter--${level}`} aria-label="今月のAI料金">
      <div className="usage-meter__head">
        <span className="usage-meter__title">{month}のAI料金（見積もり）</span>
        <span className="usage-meter__percent">{percent}%</span>
      </div>
      <p className="usage-meter__amount">
        <strong>{formatYen(usage.yen)}</strong>
        <span>／ 上限 {formatYen(budgetYen)}</span>
      </p>
      <div
        className="usage-meter__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`上限の${percent}%を使っています`}
      >
        <div className="usage-meter__fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="usage-meter__note">
        {level === 'over'
          ? '上限に達しました。来月まで、新しい投稿は作りません（設定で上限を上げると、再開します）。'
          : level === 'warn'
            ? 'もうすぐ上限です。上限に達すると、新しい投稿を作らなくなります。'
            : '文を作るたびに増えます。上限に近づくと、新しい投稿を作らなくなります。'}
      </p>
    </section>
  )
}
