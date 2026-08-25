import type { ReactNode } from 'react'
import type { Photo } from '../assets/photos'

interface Props {
  photo: Photo
  /** 写真の上に大きく置く見出し。 */
  title: ReactNode
  /** 見出しの下の補助文。 */
  subtitle?: ReactNode
  /** 見出しの上に置く小さなラベル（残件数など）。 */
  overline?: ReactNode
  /** 見出しの下に置くCTA。 */
  children?: ReactNode
  /** 帯として使う低い形。フォロー整理の画面見出しなど。 */
  compact?: boolean
  className?: string
}

/**
 * 写真の上に文字を重ねる面。
 *
 * 写真は常に装飾なので alt="" で支援技術から隠す（意味は重ねた文字が持つ）。
 * 文字側には必ず暗いグラデーション（--photo-scrim）を敷く。写真は差し替えられる
 * 前提なので、明るい写真が来た瞬間に白文字が読めなくなるのを防ぐための保険。
 */
export function PhotoHero({
  photo,
  title,
  subtitle,
  overline,
  children,
  compact,
  className,
}: Props) {
  const classes = ['photo-hero']
  if (compact) classes.push('photo-hero--compact')
  if (className) classes.push(className)

  return (
    <section className={classes.join(' ')}>
      <img className="photo-hero__image" src={photo.src} alt="" aria-hidden="true" />
      <div className="photo-hero__scrim" aria-hidden="true" />
      <div className="photo-hero__body">
        {overline && <span className="photo-hero__overline">{overline}</span>}
        <h1 className="photo-hero__title">{title}</h1>
        {subtitle && <p className="photo-hero__subtitle">{subtitle}</p>}
        {children && <div className="photo-hero__actions">{children}</div>}
      </div>
    </section>
  )
}
