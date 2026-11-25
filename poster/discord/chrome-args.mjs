// Chrome を起動するときの引数。headless のとき画面（ウインドウ）を出さずに裏で動かす。
// config.json の "headless": true で有効（試験中。通らなければ false か項目ごと消せば画面ありに戻る）。
// 画面なしの既定の大きさは 800x600 と狭く、サイトが携帯向けの並びになって投稿欄が出ない
// （Yay で 2026-11-13 に実際に起きた）ので、普通の画面の大きさを一緒に指定する。
// post.mjs は読み込むだけで投稿役が動き出すので、テストできるようここに分けてある。
export function chromeArgs({ port, profile, url, headless = false }) {
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(headless ? ["--headless=new", "--window-size=1280,900"] : []),
    url,
  ];
}
