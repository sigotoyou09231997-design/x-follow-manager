import type { ChannelName } from './api'

// 「自動投稿」タブで、最後に開いていた投稿先（ディスコード / Yay）を覚えておく場所。
// ホームの「いまの動き」から特定の投稿先を開くときも、ここへ書いてからタブを切り替える。
// （ブラウザの保存先が使えない環境では、覚えられないだけ。いつもの先頭に戻る）
const TAB_KEY = 'autopost_tab'

export function readAutopostTab(): ChannelName {
  try {
    const stored = localStorage.getItem(TAB_KEY)
    if (stored === 'discord' || stored === 'yay') return stored
  } catch {
    // 保存できない環境（プライベートウィンドウなど）では、いつもの先頭に戻るだけ。
  }
  return 'discord'
}

export function rememberAutopostTab(name: ChannelName): void {
  try {
    localStorage.setItem(TAB_KEY, name)
  } catch {
    // 覚えておけないだけ。
  }
}
