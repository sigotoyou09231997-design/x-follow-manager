import type { ChannelName } from './api'

/** 「自動投稿」タブの中の切り替え先。ディスコード・Yay は Mac の投稿役、X はサーバーが投稿する自動運転。 */
export type AutopostTab = ChannelName | 'x'

// 「自動投稿」タブで、最後に開いていた投稿先（ディスコード / Yay / X）を覚えておく場所。
// ホームの「いまの動き」から特定の投稿先を開くときも、ここへ書いてからタブを切り替える。
// （ブラウザの保存先が使えない環境では、覚えられないだけ。いつもの先頭に戻る）
const TAB_KEY = 'autopost_tab'

export function readAutopostTab(): AutopostTab {
  try {
    const stored = localStorage.getItem(TAB_KEY)
    if (stored === 'discord' || stored === 'yay' || stored === 'x') return stored
  } catch {
    // 保存できない環境（プライベートウィンドウなど）では、いつもの先頭に戻るだけ。
  }
  return 'discord'
}

export function rememberAutopostTab(name: AutopostTab): void {
  try {
    localStorage.setItem(TAB_KEY, name)
  } catch {
    // 覚えておけないだけ。
  }
}
