import { describe, expect, it } from 'vitest'
import { estimate, intervalLabel } from './xRepeat'

describe('X（くり返し）の間隔', () => {
  it('分・時間・1日1回で言い分ける', () => {
    expect(intervalLabel(15)).toBe('15分おき')
    expect(intervalLabel(120)).toBe('2時間おき')
    expect(intervalLabel(1440)).toBe('1日1回')
  })

  it('終日投稿したときの1日の本数と、月の X API の料金（10円単位）', () => {
    expect(estimate(60)).toEqual({ perDay: 24, monthlyYen: 1620 })
    expect(estimate(10)).toEqual({ perDay: 144, monthlyYen: 9720 })
    expect(estimate(1440)).toEqual({ perDay: 1, monthlyYen: 70 })
  })
})
