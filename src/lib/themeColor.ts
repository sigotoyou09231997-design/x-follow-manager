// スマホの一番上の帯（時刻・電波が出ている所）の色を、いま開いている画面の地の色にそろえる。
//
// 帯の色は <meta name="theme-color"> で決まる。以前は薄い灰青緑（#f3f6f6）に固定していたが、
// トップの地は白なので、帯と画面の境目が線のように見え、「アプリ感がない」と本人に言われた（2026-11-22）。
// 地の色は画面ごと（トップは白・ほかは薄い灰青緑）・ライト／ダークで変わるので、実際に描かれている色を読んで合わせる。

const TRANSPARENT = new Set(['', 'transparent', 'rgba(0, 0, 0, 0)'])

/** いまの画面の地の色を読んで、theme-color に入れる。読めなければ何もしない（index.html の既定のまま）。 */
export function syncThemeColor(root: ParentNode = document): string | null {
  // 画面の外枠（.app-shell）が透明な画面（トップ以外）は、その奥の body・html の色が見えているので、順に奥を読む。
  const layers = [root.querySelector('.app-shell'), document.body, document.documentElement]
  const color = layers
    .filter((el): el is Element => !!el)
    .map((el) => getComputedStyle(el).backgroundColor)
    .find((c) => !TRANSPARENT.has(c))
  if (!color) return null
  // ライト用・ダーク用の2つがあるが、読んだ色はいま効いている方の色なので、両方に入れてよい
  // （ライト・ダークが切り替わったら、呼び直して入れ直す）。
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', color))
  return color
}
