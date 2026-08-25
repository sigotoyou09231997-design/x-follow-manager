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
// 予約投稿タブは preview に /api が無いので「接続情報が取れない」案内に落ちる。
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

const VIEWPORTS = [
  // PC: ヘッダー＋左サイドバー＋中央＋右詳細の3カラム
  { name: 'pc', width: 1440, height: 960 },
  // タブレット: サイドバーが消えて下部バーに変わる境目（1023px以下）
  { name: 'tablet', width: 900, height: 1000 },
  // モバイル: iPhone 相当
  { name: 'mobile', width: 390, height: 844 },
]

const THEMES = ['light', 'dark']

// 撮る画面。open() が「その画面を出す」ところまでを担当する。
// pcOnly は、狭い画面には入口が無い画面（サイドバーにしか項目が無いもの）。
const SCREENS = [
  {
    name: 'home',
    async open(page) {
      await goHome(page)
    },
  },
  {
    name: 'tidy',
    async open(page) {
      await gotoTab(page, 'フォロー整理')
      await page.locator('.account-row').first().waitFor()
    },
  },
  {
    name: 'tidy-review',
    async open(page) {
      // 狭い画面では詳細が一覧の上に全画面で被さる。PCでは右カラムに出る。
      // 同じ操作で両方の姿が撮れるので、分岐は置かない。
      await gotoTab(page, 'フォロー整理')
      await page.locator('.account-row').first().click()
      await page.locator('.review-panel').waitFor()
    },
  },
  {
    name: 'protected',
    async open(page) {
      // 狭い画面の下部バーには項目が無く、ホームの「残す」カードが入口。
      if (await sideNavVisible(page)) await gotoTab(page, '残すリスト')
      else {
        await goHome(page)
        await page.locator('.entry-card', { hasText: '残す' }).click()
      }
    },
  },
  {
    name: 'history',
    pcOnly: true,
    async open(page) {
      await gotoTab(page, '履歴')
    },
  },
  {
    name: 'schedule',
    async open(page) {
      await gotoTab(page, '予約投稿')
      await page.locator('.schedule-view').waitFor()
    },
  },
  {
    name: 'settings',
    async open(page) {
      await gotoTab(page, '設定')
      await page.locator('.settings-view').waitFor()
    },
  },
  {
    name: 'onboarding',
    async open(page) {
      // 読み込み前の姿。他の画面と違いデータを消してから撮るので、最後に回している。
      await gotoTab(page, '設定')
      await page.getByRole('button', { name: 'ローカルデータをすべて削除' }).click()
      await page.getByRole('button', { name: '削除を実行する' }).click()
      await page.getByText('Xアーカイブ ZIP をドロップ').waitFor()
    },
  },
]

function sideNavVisible(page) {
  return page.locator('.side-nav').isVisible()
}

// ホームはサイドバーにも下部バーにも無い経路がある（PCはロゴだけが入口）。
// ロゴはどの幅でも出ているので、こちらに寄せる。
async function goHome(page) {
  await page.getByRole('button', { name: 'Follow tidy' }).click()
}

// PCは左サイドバー、狭い画面は下部バー。同じラベルでも出ている方を押す。
async function gotoTab(page, label) {
  if (await sideNavVisible(page)) {
    await page.locator('.side-nav').getByRole('button', { name: label, exact: true }).click()
    return
  }
  await page.locator('.bottom-nav__item', { hasText: label }).click()
}

async function seed(page) {
  await page.goto(BASE_URL)
  await page.locator('input[type="file"]').setInputFiles(ARCHIVE)
  await page.locator('.summary-stat__value').first().waitFor()
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })

  // Playwright同梱のブラウザが無い環境（CIコンテナなど）では、既にある
  // Chromiumを CHROMIUM_PATH で指せば動く。指定が無いときは同梱のものを使う。
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  )
  let shots = 0

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
        deviceScaleFactor: 2,
      })

      for (const screen of SCREENS) {
        if (screen.pcOnly && viewport.width < 1024) continue
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
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(300)

        const base = path.join(OUT_DIR, `${viewport.name}-${theme}-${screen.name}`)
        // 画面ぴったりの1枚と、下まで伸ばした1枚の両方を撮る。
        // fullPage だと position: fixed の下部バーがページの途中に写り込み、
        // 実際の見え方とは違う位置に見えてしまうため、判断はぴったりの方でする。
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
