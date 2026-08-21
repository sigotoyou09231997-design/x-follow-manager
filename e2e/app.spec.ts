import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ARCHIVE_PATH = path.join(__dirname, 'fixtures', 'test-archive.zip')

test.describe('X非相互フォロー整理ツール', () => {
  test('アーカイブ読み込みから解除・保護・リロード復元・CSV出力までの一連の流れ', async ({ page }) => {
    // 1. アプリ起動
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'X 非相互フォロー整理ツール' })).toBeVisible()

    // 2. テストZIPを投入
    await page.locator('input[type="file"]').setInputFiles(ARCHIVE_PATH)

    // 3. 集計値の表示（following:130 / followers:100 / non-mutual:30）
    await expect(page.locator('.summary-stat__value').nth(0)).toHaveText('130')
    await expect(page.locator('.summary-stat__value').nth(1)).toHaveText('100')
    await expect(page.locator('.summary-stat__value').nth(2)).toHaveText('30')

    // 4. 非相互フォローが全件表示される（上限なし）
    await expect(page.locator('.account-row')).toHaveCount(30)

    // 5. 作業モードで10人を選択
    await page.getByRole('button', { name: '作業モード' }).click()
    await page.getByRole('button', { name: '10', exact: true }).click()
    await page.getByRole('button', { name: '次の10人を選択' }).click()
    await expect(page.locator('.batch-view .account-row')).toHaveCount(10)
    await expect(page.getByText('今回の作業 0 / 10 完了')).toBeVisible()

    // 6. 1人を保護
    const rows = page.locator('.batch-view .account-row')
    await rows.nth(0).getByRole('button', { name: '保護' }).click()
    await expect(page.getByText('今回の作業 1 / 10 完了')).toBeVisible()

    // 7. 1人を解除済みに変更
    await rows.nth(1).getByRole('button', { name: '解除済みにする' }).click()
    await expect(page.getByText('今回の作業 2 / 10 完了')).toBeVisible()

    // 8. リロード後も作業状態が復元される
    await page.reload()
    await expect(page.locator('.summary-stat__value').nth(2)).toHaveText('30')

    const summaryValues = page.locator('.summary-stat__value')
    await expect(summaryValues.nth(3)).toHaveText('28') // 未処理
    await expect(summaryValues.nth(4)).toHaveText('1') // 解除済み
    await expect(summaryValues.nth(5)).toHaveText('1') // 保護

    // 一覧タブでフィルターを確認
    await page.getByRole('button', { name: '一覧' }).click()
    const filterTabs = page.locator('.filter-bar__tabs')
    await filterTabs.getByRole('button', { name: '保護', exact: true }).click()
    await expect(page.locator('.account-row')).toHaveCount(1)

    await filterTabs.getByRole('button', { name: '解除済み', exact: true }).click()
    await expect(page.locator('.account-row')).toHaveCount(1)

    await filterTabs.getByRole('button', { name: '未処理', exact: true }).click()
    await expect(page.locator('.account-row')).toHaveCount(28)

    // 9. CSV出力
    await filterTabs.getByRole('button', { name: 'すべて', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /CSV書き出し/ }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('x-non-mutual-all.csv')
  })

  test('設定画面からローカルデータを削除できる', async ({ page }) => {
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles(ARCHIVE_PATH)
    await expect(page.locator('.account-row')).toHaveCount(30)

    await page.getByRole('button', { name: '設定' }).click()
    await page.getByRole('button', { name: 'ローカルデータをすべて削除' }).click()
    await page.getByRole('button', { name: '削除を実行する' }).click()

    await expect(page.getByText('Xアーカイブ ZIP をドロップ')).toBeVisible()
  })
})
