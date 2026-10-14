// 画面の見た目（とくに要素の位置）を触るときに、変更前後を並べて見比べるための
// スクリーンショット撮影スクリプト。
//
//   npm run build && npm run preview -- --port 4173 --strictPort   # 別ターミナル
//   node scripts/design-shots.mjs                                  # 撮る
//   node scripts/design-shots.mjs --out .design-shots/after        # 変更後を別名で撮る
//
// E2Eと同じ合成アーカイブを読ませてから撮る。空の状態で撮ると一覧も詳細も出ず、
// 「位置を直したい当の要素が写っていない」画像ばかりが並ぶため。
//
// トップ（自動投稿）と予約投稿は preview に /api が無いので「接続情報が取れない」案内に落ちる。
// これは撮れる範囲での正しい姿なので、そのまま撮っている。

import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'

const ROOT = path.resolve(import.meta.dirname, '..')
const ARCHIVE = path.join(ROOT, 'e2e', 'fixtures', 'test-archive.zip')

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const BASE_URL = arg('--url', process.env.DESIGN_SHOTS_URL ?? 'http://localhost:4173')
const OUT_DIR = path.resolve(ROOT, arg('--out', '.design-shots'))
// 直したところだけ撮り直したいとき: --screens home,tidy / --viewports mobile
const ONLY_SCREENS = arg('--screens', '')
  .split(',')
  .filter(Boolean)
const ONLY_VIEWPORTS = arg('--viewports', '')
  .split(',')
  .filter(Boolean)

const VIEWPORTS = [
  // PC: ヘッダー＋中央（フォロー整理は一覧＋右詳細の2カラム）
  { name: 'pc', width: 1440, height: 960 },
  // タブレット: 詳細が一覧の上に被さる形に変わる境目（1023px以下）
  { name: 'tablet', width: 900, height: 1000 },
  // モバイル: iPhone 相当
  { name: 'mobile', width: 390, height: 844 },
]

const THEMES = ['light', 'dark']

// 撮る画面。open() が「その画面を出す」ところまでを担当する。
// 入口は自動投稿の1画面（home）。ほかの画面は、設定の「機能」から開く。
const SCREENS = [
  {
    name: 'home',
    async open(page) {
      await page.locator('.autopost, .schedule-view--notice').first().waitFor()
    },
  },
  {
    name: 'settings',
    async open(page) {
      await gotoSettings(page)
      await page.locator('.settings-view').waitFor()
    },
  },
  {
    name: 'tidy',
    async open(page) {
      await gotoFeature(page, 'フォロー整理')
      await page.locator('.account-row').first().waitFor()
    },
  },
  {
    name: 'tidy-review',
    async open(page) {
      // 狭い画面では詳細が一覧の上に全画面で被さる。PCでは右カラムに出る。
      // 同じ操作で両方の姿が撮れるので、分岐は置かない。
      await gotoFeature(page, 'フォロー整理')
      await page.locator('.account-row').first().click()
      await page.locator('.review-panel').waitFor()
    },
  },
  {
    name: 'protected',
    async open(page) {
      await gotoFeature(page, '残すリスト')
    },
  },
  {
    name: 'history',
    async open(page) {
      await gotoFeature(page, '履歴')
    },
  },
  {
    name: 'schedule',
    async open(page) {
      await gotoFeature(page, '予約投稿')
      await page.locator('.schedule-view').waitFor()
    },
  },
  {
    name: 'autopost-detail',
    async open(page) {
      await gotoFeature(page, '自動投稿の文と設定')
      await page.locator('.autopost').first().waitFor()
    },
  },
  {
    name: 'onboarding',
    async open(page) {
      // 読み込み前の姿。他の画面と違いデータを消してから撮るので、最後に回している。
      await gotoSettings(page)
      await page.getByRole('button', { name: 'ローカルデータをすべて削除' }).click()
      await page.getByRole('button', { name: '削除を実行する' }).click()
      await page.getByRole('button', { name: '設定を開く' }).waitFor()
      await gotoFeature(page, 'フォロー整理')
      await page.getByText('まずアーカイブを読み込みます').waitFor()
    },
  },
]

// トップなら右上の設定ボタン、ほかの画面ならヘッダーの「‹ 設定」から設定へ入る。
async function gotoSettings(page) {
  const back = page.getByRole('button', { name: '設定へ戻る' })
  if (await back.isVisible()) await back.click()
  else await page.getByRole('button', { name: '設定を開く' }).click()
}

async function gotoFeature(page, label) {
  await gotoSettings(page)
  await page
    .getByRole('region', { name: '機能' })
    .getByRole('button', { name: new RegExp(`^${label}`) })
    .click()
}

async function seed(page) {
  await page.goto(BASE_URL)
  // トップ（自動投稿）は preview では接続情報の案内になる。描画を待ってから、フォロー整理でアーカイブを入れる。
  await page.locator('.app-header__logo').waitFor()
  // 同じcontextの中ではIndexedDBが共有されるので、2枚目以降は既に読み込み済み。
  // 読み込みの案内（＝ファイル入力）が出ているときだけ入れ直す。
  await gotoFeature(page, 'フォロー整理')
  await page.locator('.onboarding, .summary-stat__value').first().waitFor()
  if ((await page.locator('.onboarding input[type="file"]').count()) > 0) {
    await page.locator('.onboarding input[type="file"]').setInputFiles(ARCHIVE)
  }
  await page.locator('.summary-stat__value').first().waitFor()
  // 撮る画面は、トップから開き直す（画面の状態を引きずらない）。
  await page.goto(BASE_URL)
  await page.locator('.app-header__logo').waitFor()
}

async function main() {
  // 一部だけ撮り直すときは、残りの画像を消さない。
  if (!ONLY_SCREENS.length && !ONLY_VIEWPORTS.length) {
    await rm(OUT_DIR, { recursive: true, force: true })
  }
  await mkdir(OUT_DIR, { recursive: true })

  // Playwright同梱のブラウザが無い環境（CIコンテナなど）では、既にある
  // Chromiumを CHROMIUM_PATH で指せば動く。指定が無いときは同梱のものを使う。
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  )
  let shots = 0

  for (const viewport of VIEWPORTS) {
    if (ONLY_VIEWPORTS.length && !ONLY_VIEWPORTS.includes(viewport.name)) continue
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
        deviceScaleFactor: 2,
      })

      for (const screen of SCREENS) {
        if (ONLY_SCREENS.length && !ONLY_SCREENS.includes(screen.name)) continue
        const page = await context.newPage()
        // テーマは data-theme が @media より強い。CSSの2系統が食い違っていても
        // 撮ったテーマの通りに写るよう、明示的に指定する。
        await page.addInitScript((value) => {
          document.documentElement.dataset.theme = value
        }, theme)

        await seed(page)
        await screen.open(page, viewport)
        // フォントの再描画とスクロール位置の確定を待つ。これが無いと
        // 「同じ画面なのに前後で数pxずれた画像」になり、比較の役に立たない。
        // クリックした場所にポインタが残ると、その下のボタンが :hover のまま写る。
        // 「押している最中の色」が既定の色に見えてしまうので、端へ逃がす。
        await page.mouse.move(0, 0)
        // 画面を切り替えてもスクロール位置は残る。上端から撮らないと、
        // 「ヘッダーに隠れた見出し」のような実際には起きていない絵になる。
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(300)

        const base = path.join(OUT_DIR, `${viewport.name}-${theme}-${screen.name}`)
        // 画面ぴったりの1枚と、下まで伸ばした1枚の両方を撮る。
        // fullPage だと position: sticky のヘッダーなどが実際とは違う位置に写ることがあるため、
        // 判断はぴったりの方でする。
        await page.screenshot({ path: `${base}.png` })
        await page.screenshot({ path: `${base}-full.png`, fullPage: true })
        shots += 2
        await page.close()
      }

      await context.close()
    }
  }

  await browser.close()
  console.log(`${shots}枚を ${path.relative(ROOT, OUT_DIR)}/ に保存しました`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
