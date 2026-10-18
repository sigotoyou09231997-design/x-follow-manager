import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

interface Props {
  /** 上に置く線画。既存のアイコンセット（24グリッド・線幅1.8）から1点だけ。 */
  icon: IconName
  title: string
  /** 1行の説明。「なぜ空なのか」ではなく「次に何ができるか」を書く。 */
  description: ReactNode
  /** 次の一手のボタン。無い画面（絞り込みで空になっただけ等）では省く。 */
  action?: ReactNode
}

/**
 * 何も無い画面。灰色の枠と文字だけで終わると、壊れているのか空なのか分からないので、
 * 「線画 → 題名 → 1行説明 →（あれば）ボタン」の形にアプリ全体で揃える。
 */
export function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="empty-state">
      <span className="empty-state__art" aria-hidden="true">
        <Icon name={icon} size={32} />
      </span>
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__hint">{description}</p>
      {action}
    </div>
  )
}
