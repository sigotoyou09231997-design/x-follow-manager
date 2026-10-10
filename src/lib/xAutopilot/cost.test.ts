import { describe, expect, it } from 'vitest'
import { aiCostYen, monthlyFixedYen, monthlyYen, onePostYen, setupYen } from './cost'

// 画面に出す見積もりは、ユーザーに伝えた金額（月の目安）と食い違ってはいけない。
// 単価や想定トークン数を変えたら、このテストが「伝えた金額と変わった」ことに気づかせる。
describe('費用の見積もり', () => {
  it('1本あたり: 標準 約9円 / 節約 約6円（Xへの投稿 2.25円を含む）', () => {
    expect(onePostYen('standard')).toBeCloseTo(8.25, 1) // AI 6.0 + X 2.25
    expect(onePostYen('saver')).toBeCloseTo(5.25, 1) // AI 3.0 + X 2.25
  })

  it('AIの料金: 標準は入力$4・出力$20、節約は入力$2・出力$10（100万トークンあたり）', () => {
    expect(aiCostYen('standard', 1_000_000, 0)).toBeCloseTo(600, 0)
    expect(aiCostYen('standard', 0, 1_000_000)).toBeCloseTo(3000, 0)
    expect(aiCostYen('saver', 1_000_000, 0)).toBeCloseTo(300, 0)
    expect(aiCostYen('saver', 0, 1_000_000)).toBeCloseTo(1500, 0)
  })

  it('月の目安（毎日・30日）: 伝えた金額と同じ', () => {
    const rows = {
      standard: { 1: 370, 3: 910, 5: 1460 },
      saver: { 1: 220, 3: 560, 5: 900 },
    } as const
    for (const quality of ['standard', 'saver'] as const) {
      for (const n of [1, 3, 5] as const) {
        // 丸めの差（±30円）は許す。大きくずれたら、伝えた金額が古くなっている
        expect(Math.abs(monthlyYen(quality, n) - rows[quality][n])).toBeLessThanOrEqual(30)
      }
    }
  })

  it('投稿が多いほど高く、8本でも固定費を除けば本数に比例する', () => {
    expect(monthlyYen('standard', 8)).toBeGreaterThan(monthlyYen('standard', 5))
    const fixed = monthlyFixedYen('standard')
    const perPost = (monthlyYen('standard', 8) - fixed) / 8
    const perPost1 = (monthlyYen('standard', 1) - fixed) / 1
    expect(perPost).toBeCloseTo(perPost1, -1)
  })

  it('最初の1回（履歴200件の読み取り＋文体のまとめ）は、標準で約50円・節約で約40円', () => {
    expect(setupYen('standard')).toBeGreaterThan(40)
    expect(setupYen('standard')).toBeLessThan(70)
    expect(setupYen('saver')).toBeLessThan(setupYen('standard'))
  })
})
