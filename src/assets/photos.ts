// 画面で使う写真の入口。**写真を差し替えるときはここだけを直す。**
//
// いま入っているのはレイアウト確認用の仮素材（ウォームグラデーションのSVG）で、
// 写真ではない。ライセンスの分からない画像をリポジトリに入れないための措置で、
// 実写に差し替える前提の枠として置いている。
//
// 差し替え方: src/assets/photos/ に同じ縦横比の画像（webp / avif 推奨）を置き、
// 下の import 先を差し替える。比率が変わるとHeroの高さやカードの座りが崩れるので、
// aspect は各画面のCSS（.photo-hero など）と揃える。
//
// 外部URLへ直リンクしないこと。オフラインで開いたときに写真だけ欠け、
// 文字を重ねている面が真っ白になって読めなくなる。

import homeHero from './photos/home-hero.svg'
import composerCover from './photos/composer-cover.svg'
import tidyBand from './photos/tidy-band.svg'
import textCardFallback from './photos/text-card-fallback.svg'

export interface Photo {
  src: string
  /** 縦横比。CSSの aspect-ratio にそのまま渡す。 */
  aspect: string
}

export const PHOTOS = {
  /** ホームのHero。デスク＋スマートフォン＋ノートを想定。 */
  homeHero: { src: homeHero, aspect: '16 / 10' },
  /** 新しい投稿のカバー。カフェのデスク＋PC＋コーヒーを想定。 */
  composerCover: { src: composerCover, aspect: '4 / 3' },
  /** フォロー整理の帯。横長で、上に見出しと残件数を重ねる。 */
  tidyBand: { src: tidyBand, aspect: '16 / 5' },
  /** 画像を持たない投稿カードの下敷き。 */
  textCardFallback: { src: textCardFallback, aspect: '16 / 9' },
} satisfies Record<string, Photo>
