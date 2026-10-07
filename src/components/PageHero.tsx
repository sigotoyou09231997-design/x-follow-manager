import type { ReactNode } from 'react'

interface Props {
  /** 画面の見出し。 */
  title: ReactNode
  /** 見出しの下の補助文。 */
  subtitle?: ReactNode
  /** 見出しの上に置く小さなラベル（残件数など）。 */
  overline?: ReactNode
  /** 見出しの下に置くCTA。 */
  children?: ReactNode
  /** 一覧の上に置く低い形。フォロー整理の画面見出しなど。 */
  compact?: boolean
  className?: string
}

/**
 * 画面の先頭に置く大きな見出し。
 *
 * 面や写真は敷かず、地の上に文字だけを置く。見出しが「いまどの画面か」を言い切り、
 * 色を持つのはその下の主ボタンだけ、という形にして画面を静かに保つ。
 */
export function PageHero({ title, subtitle, overline, children, compact, className }: Props) {
  const classes = ['page-hero']
  if (compact) classes.push('page-hero--compact')
  if (className) classes.push(className)

  return (
    <section className={classes.join(' ')}>
      {overline && <span className="page-hero__overline">{overline}</span>}
      <h1 className="page-hero__title">{title}</h1>
      {subtitle && <p className="page-hero__subtitle">{subtitle}</p>}
      {children && <div className="page-hero__actions">{children}</div>}
    </section>
  )
}
