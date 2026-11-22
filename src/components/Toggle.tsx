// オンオフのスイッチ。トップの稼働スイッチと、設定の「まとめて止める・再開の対象」で同じものを使う。
// 見た目（.toggle）は theme-polish.css（どの画面でも読み込まれる）。

interface ToggleProps {
  /** オン＝動いている（止める操作を受け付ける）。 */
  on: boolean
  /** 押したあと、相手（Mac・サーバー）が受け取るまでの途中。つまみを薄くして、まだ確定していないと分かるようにする。 */
  pending?: boolean
  disabled?: boolean
  /** 何のスイッチか（例: 「ディスコードの自動投稿」）。状態は aria-checked で伝える。 */
  label: string
  onClick: () => void
}

/**
 * 止める・再開するのオンオフ。トップに赤い「止める」ボタンが縦に何個も並ぶと、画面がうるさく、
 * どれが動いているのかも色で読み取りにくかったので、動いている＝青緑のオン、止まっている＝灰色のオフ、の1つにした。
 */
export function Toggle({ on, pending, disabled, label, onClick }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={pending || undefined}
      className={`toggle${on ? ' toggle--on' : ''}${pending ? ' toggle--pending' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="toggle__thumb" aria-hidden="true" />
    </button>
  )
}
