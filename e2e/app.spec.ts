import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARCHIVE_PATH = path.join(__dirname, 'fixtures', 'test-archive.zip')

// 既定のビューポート(1280x720)はPCレイアウト。左サイドバー＋中央リスト＋右詳細パネル。
test.describe('X非相互フォロー整理ツール', () => {
  test('アーカイブ読み込みから解除・残す・リロード復元・CSV出力までの一連の流れ', async ({ page }) => {
    // 1. アプリ起動
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Follow tidy' })).toBeVisible()

    // 2. テストZIPを投入
    await page.locator('input[type="file"]').setInputFiles(ARCHIVE_PATH)

    // 3. 読み込み後はホーム。集計値の表示（following:130 / followers:100 / non-mutual:30）
    await expect(page.locator('.summary-stat__value').nth(0)).toHaveText('130')
    await expect(page.locator('.summary-stat__value').nth(1)).toHaveText('100')
    await expect(page.locator('.summary-stat__value').nth(2)).toHaveText('30')

    // 4. フォロー整理画面に非相互フォローが全件表示される（上限なし）
    const sideNav = page.locator('.side-nav')
    await sideNav.getByRole('button', { name: 'フォロー整理' }).click()
    await expect(page.locator('.account-row')).toHaveCount(30)

    // 5. 10人のバッチを選択すると、先頭の1件が確認カードに出る
    await page.locator('.batch-controls__size').getByRole('button', { name: '10', exact: true }).click()
    await page.getByRole('button', { name: '次の10人を選択' }).click()
    await expect(page.getByText('今回の作業 0 / 10 完了')).toBeVisible()

    const panel = page.locator('.review-panel')
    await expect(panel.locator('.review-panel__progress')).toHaveText('1 / 10')

    // 6. 1人を「残す」にすると、次の1件へ進む
    await panel.getByRole('button', { name: '残す', exact: true }).click()
    await expect(page.getByText('今回の作業 1 / 10 完了')).toBeVisible()
    await expect(panel.locator('.review-panel__progress')).toHaveText('2 / 10')

    // 7. 1人を解除済みに変更
    await panel.getByRole('button', { name: '解除済みにする' }).click()
    await expect(page.getByText('今回の作業 2 / 10 完了')).toBeVisible()

    // 8. リロード後も作業状態が復元される
    await page.reload()
    await expect(page.locator('.summary-stat__value').nth(2)).toHaveText('30')

    const summaryValues = page.locator('.summary-stat__value')
    await expect(summaryValues.nth(3)).toHaveText('28') // 未確認
    await expect(summaryValues.nth(4)).toHaveText('1') // 解除済み
    await expect(summaryValues.nth(5)).toHaveText('1') // 残す

    // 9. フィルタタブ（すべて / 未確認 / 残す）
    await sideNav.getByRole('button', { name: 'フォロー整理' }).click()
    const filterTabs = page.locator('.filter-bar__tabs')
    await filterTabs.getByRole('button', { name: '残す', exact: true }).click()
    await expect(page.locator('.account-row')).toHaveCount(1)

    await filterTabs.getByRole('button', { name: '未確認', exact: true }).click()
    await expect(page.locator('.account-row')).toHaveCount(28)

    // 10. 解除済みは履歴画面のタイムラインで確認する
    await sideNav.getByRole('button', { name: '履歴' }).click()
    await expect(page.locator('.timeline__item')).toHaveCount(2)
    await expect(page.locator('.timeline__item--done')).toHaveCount(1)

    // 11. 残すリストはフィルタ固定の一覧
    await sideNav.getByRole('button', { name: '残すリスト' }).click()
    await expect(page.locator('.account-row')).toHaveCount(1)

    // 12. CSV出力
    await sideNav.getByRole('button', { name: 'フォロー整理' }).click()
    await filterTabs.getByRole('button', { name: 'すべて', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /CSV書き出し/ }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('x-non-mutual-all.csv')
  })

  // 中央の＋は予約投稿の作成入口。押した先が予約投稿タブであることを守る。
  test('モバイル: 中央の＋は予約投稿を開く', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles(ARCHIVE_PATH)
    await expect(page.locator('.summary-stat__value').nth(2)).toHaveText('30')

    await page.locator('.bottom-nav__fab').click()

    // preview には /api が無いため、予約投稿は「接続情報が取れない」案内を出す。
    // ここで見たいのは、＋が予約投稿タブへ確かに移動していること。
    await expect(page.locator('.schedule-view')).toBeVisible()
    await expect(
      page.locator('.bottom-nav__item', { hasText: '予約投稿' })
    ).toHaveClass(/active/)
  })

  // 確認作業が「押しても何も起きない」状態にならないことを守る。
  // 以前は未確認0件のとき disabled になり、理由の表示もなく無反応だった。
  test('モバイル: ホームから確認を始め、続きから再開できる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles(ARCHIVE_PATH)

    const panel = page.locator('.review-panel')
    const home = page.locator('.bottom-nav__item', { hasText: 'ホーム' })
    const startButton = () => page.locator('.task-item').getByRole('button')

    // 1回目: バッチが始まり、先頭の1件が確認カードに出る
    await startButton().click()
    await expect(panel.locator('.review-panel__progress')).toHaveText('1 / 30')

    // 1件処理してカードを閉じ、ホームへ戻ると「続きから」になる
    await panel.getByRole('button', { name: '残す', exact: true }).click()
    await expect(panel.locator('.review-panel__progress')).toHaveText('2 / 30')
    await panel.getByRole('button', { name: '閉じる' }).click()
    await expect(panel).toBeHidden()

    await home.click()
    await expect(startButton()).toHaveText('続きから')
    await startButton().click()
    await expect(panel.locator('.review-panel__progress')).toHaveText('2 / 30')
    await panel.getByRole('button', { name: '閉じる' }).click()

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

    // 未確認0件でも無反応にはせず、「すべて確認済み」だと分かる画面へ送る
    await expect(startButton()).toBeEnabled()
    await startButton().click()
    await expect(page.getByText('未確認のアカウントはありません。すべて確認済みです。')).toBeVisible()
  })

  test('設定画面からローカルデータを削除できる', async ({ page }) => {
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles(ARCHIVE_PATH)
    await expect(page.locator('.summary-stat__value').nth(2)).toHaveText('30')

    const sideNav = page.locator('.side-nav')
    await sideNav.getByRole('button', { name: 'フォロー整理' }).click()
    await expect(page.locator('.account-row')).toHaveCount(30)

    await sideNav.getByRole('button', { name: '設定' }).click()
    await page.getByRole('button', { name: 'ローカルデータをすべて削除' }).click()
    await page.getByRole('button', { name: '削除を実行する' }).click()

    await expect(page.getByText('Xアーカイブ ZIP をドロップ')).toBeVisible()
  })
})
