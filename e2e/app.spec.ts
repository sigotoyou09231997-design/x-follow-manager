import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARCHIVE_PATH = path.join(__dirname, 'fixtures', 'test-archive.zip')

// 入口は「自動投稿の1画面」。フォロー整理・残すリスト・履歴・予約投稿などは、設定の「機能」から開く。
// トップにいるときは右上の設定ボタン、ほかの画面にいるときはヘッダーの「‹ 設定」で設定に入る。
async function openFeature(page: Page, label: string) {
  const back = page.getByRole('button', { name: '設定へ戻る' })
  if (await back.isVisible()) await back.click()
  else await page.getByRole('button', { name: '設定を開く' }).click()
  await page
    .getByRole('region', { name: '機能' })
    .getByRole('button', { name: new RegExp(`^${label}`) })
    .click()
}

// アーカイブは、フォロー整理を開いたときの読み込みの案内から入れる。
async function importArchive(page: Page) {
  await openFeature(page, 'フォロー整理')
  await page.locator('input[type="file"]').setInputFiles(ARCHIVE_PATH)
  await expect(page.locator('.summary-stat__value').nth(2)).toHaveText('30')
}

// 既定のビューポート(1280x720)はPCレイアウト。中央のリスト＋右の詳細パネル。
test.describe('X非相互フォロー整理ツール', () => {
  test('アーカイブ読み込みから解除・残す・リロード復元・CSV出力までの一連の流れ', async ({ page }) => {
    // 1. アプリ起動。最初は自動投稿の1画面（preview には /api が無いので、接続情報の案内になる）
    await page.goto('/')
    await expect(page.locator('.app-header__logo')).toHaveText('SNSアプリ')
    await expect(page.locator('.bottom-nav, .side-nav')).toHaveCount(0)

    // 2. 設定 → フォロー整理 → テストZIPを投入。集計値の表示（following:130 / followers:100 / non-mutual:30）
    await importArchive(page)
    await expect(page.locator('.summary-stat__value').nth(0)).toHaveText('130')
    await expect(page.locator('.summary-stat__value').nth(1)).toHaveText('100')

    // 3. フォロー整理画面に非相互フォローが全件表示される（上限なし）
    await expect(page.locator('.account-row')).toHaveCount(30)

    // 4. 10人のバッチを選択すると、先頭の1件が確認カードに出る
    await page.locator('.batch-controls__size').getByRole('button', { name: '10', exact: true }).click()
    await page.getByRole('button', { name: '次の10人を選択' }).click()
    await expect(page.getByText('今回の作業 0 / 10 完了')).toBeVisible()

    const panel = page.locator('.review-panel')
    await expect(panel.locator('.review-panel__progress')).toHaveText('1 / 10')

    // 5. 1人を「残す」にすると、次の1件へ進む
    await panel.getByRole('button', { name: '残す', exact: true }).click()
    await expect(page.getByText('今回の作業 1 / 10 完了')).toBeVisible()
    await expect(panel.locator('.review-panel__progress')).toHaveText('2 / 10')

    // 6. 1人を解除済みに変更
    await panel.getByRole('button', { name: '解除済みにする' }).click()
    await expect(page.getByText('今回の作業 2 / 10 完了')).toBeVisible()

    // 7. リロード後も作業状態が復元される（リロードするとトップに戻るので、設定から開き直す）
    await page.reload()
    await openFeature(page, 'フォロー整理')
    const summaryValues = page.locator('.summary-stat__value')
    await expect(summaryValues.nth(2)).toHaveText('30')
    await expect(summaryValues.nth(3)).toHaveText('28') // 未確認
    await expect(summaryValues.nth(4)).toHaveText('1') // 解除済み
    await expect(summaryValues.nth(5)).toHaveText('1') // 残す

    // 8. フィルタタブ（すべて / 未確認 / 残す）
    const filterTabs = page.locator('.filter-bar__tabs')
    await filterTabs.getByRole('button', { name: '残す', exact: true }).click()
    await expect(page.locator('.account-row')).toHaveCount(1)

    await filterTabs.getByRole('button', { name: '未確認', exact: true }).click()
    await expect(page.locator('.account-row')).toHaveCount(28)

    // 9. 解除済みは履歴画面のタイムラインで確認する
    await openFeature(page, '履歴')
    await expect(page.locator('.timeline__item')).toHaveCount(2)
    await expect(page.locator('.timeline__item--done')).toHaveCount(1)

    // 10. 残すリストはフィルタ固定の一覧
    await openFeature(page, '残すリスト')
    await expect(page.locator('.account-row')).toHaveCount(1)

    // 11. CSV出力
    await openFeature(page, 'フォロー整理')
    await filterTabs.getByRole('button', { name: 'すべて', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /CSV書き出し/ }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('x-non-mutual-all.csv')
  })

  // 画面を移るたびに、ヘッダーの戻るが「1つ前」を指すことを守る（メニューバーが無いので、戻る道はこれだけ）。
  test('モバイル: 設定から予約投稿を開き、戻るで設定、もう一度戻るでトップへ戻れる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    await page.getByRole('button', { name: '設定を開く' }).click()
    await page
      .getByRole('region', { name: '機能' })
      .getByRole('button', { name: /^予約投稿/ })
      .click()

    // preview には /api が無いため、予約投稿は「接続情報が取れない」案内を出す。
    // ここで見たいのは、予約投稿の画面へ確かに移動していること。
    await expect(page.locator('.schedule-view')).toBeVisible()
    await expect(page.locator('.app-header__title')).toHaveText('予約投稿')

    await page.getByRole('button', { name: '設定へ戻る' }).click()
    await expect(page.getByRole('region', { name: '機能' })).toBeVisible()

    await page.getByRole('button', { name: '自動投稿へ戻る' }).click()
    await expect(page.getByRole('button', { name: '設定を開く' })).toBeVisible()
  })

  // 確認作業の進み具合が、閉じても・読み込み直しても残ることを守る。
  test('モバイル: 確認を始めて1件処理し、閉じても・読み込み直しても進み具合が残る', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await importArchive(page)

    const panel = page.locator('.review-panel')

    // バッチが始まり、先頭の1件が確認カードに出る（人数の既定は100人＝30件全部）
    await page.getByRole('button', { name: '次の100人を選択' }).click()
    await expect(panel.locator('.review-panel__progress')).toHaveText('1 / 30')

    // 1件処理してカードを閉じる
    await panel.getByRole('button', { name: '残す', exact: true }).click()
    await expect(panel.locator('.review-panel__progress')).toHaveText('2 / 30')
    await panel.getByRole('button', { name: '閉じる' }).click()
    await expect(panel).toBeHidden()
    await expect(page.getByText('今回の作業 1 / 30 完了')).toBeVisible()

    // 読み込み直して開き直しても、同じバッチの進み具合が出る
    await page.reload()
    await openFeature(page, 'フォロー整理')
    await expect(page.getByText('今回の作業 1 / 30 完了')).toBeVisible()
  })

  test('モバイル: 未確認が0件のときは、無反応にせず「すべて確認済み」と伝える', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await importArchive(page)

    // 未確認を0件にする。UIで30件処理すると遅いので、保存済みデータを直接書き換える。
    await page.evaluate(async () => {
      const request = indexedDB.open('x-follow-manager')
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const tx = db.transaction('accounts', 'readwrite')
      const store = tx.objectStore('accounts')
      const rows = await new Promise<{ status: string; completedAt?: number; updatedAt: number }[]>((resolve) => {
        const req = store.getAll()
        req.onsuccess = () => resolve(req.result)
      })
      for (const row of rows) {
        row.status = 'done'
        row.completedAt = Date.now()
        row.updatedAt = Date.now()
        store.put(row)
      }
      await new Promise((resolve) => {
        tx.oncomplete = resolve
      })
    })
    await page.reload()
    await openFeature(page, 'フォロー整理')

    // 始めるボタンは押せない状態にして、未確認の一覧は「すべて確認済み」と伝える
    await expect(page.getByRole('button', { name: /^次の\d+人を選択$/ })).toBeDisabled()
    await page.locator('.filter-bar__tabs').getByRole('button', { name: '未確認', exact: true }).click()
    await expect(page.getByText('未確認のアカウントはありません。すべて確認済みです。')).toBeVisible()
  })

  test('設定画面からローカルデータを削除できる', async ({ page }) => {
    await page.goto('/')
    await importArchive(page)
    await expect(page.locator('.account-row')).toHaveCount(30)

    await page.getByRole('button', { name: '設定へ戻る' }).click()
    await page.getByRole('button', { name: 'ローカルデータをすべて削除' }).click()
    await page.getByRole('button', { name: '削除を実行する' }).click()

    // 削除するとトップに戻り、フォロー整理を開くと読み込みの案内に戻っている
    await expect(page.getByRole('button', { name: '設定を開く' })).toBeVisible()
    await openFeature(page, 'フォロー整理')
    await expect(page.getByText('まずアーカイブを読み込みます')).toBeVisible()
  })
})
