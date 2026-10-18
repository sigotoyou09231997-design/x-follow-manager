import { describe, expect, it } from 'vitest'
import { ALL_HOURS, HOUR_PRESETS, hoursLabel, normalizeHours, sameHours, toggleHour } from './hours'

describe('hoursLabel', () => {
  it('null と24時間ぜんぶは「終日」', () => {
    expect(hoursLabel(null)).toBe('終日')
    expect(hoursLabel(ALL_HOURS)).toBe('終日')
  })

  it('つながった時間は1つにまとめる', () => {
    expect(hoursLabel([9, 10, 11])).toBe('9〜12時')
    expect(hoursLabel([21, 22, 23])).toBe('21〜24時')
  })

  it('1時間だけのときは「○時台」', () => {
    expect(hoursLabel([9])).toBe('9時台')
  })

  it('離れた時間は「・」でつなぐ', () => {
    expect(hoursLabel([7, 8, 12, 13])).toBe('7〜9時・12〜14時')
  })

  it('夜をまたぐ時間は「翌」で表す', () => {
    expect(hoursLabel([22, 23, 0, 1, 2])).toBe('22時〜翌3時')
    expect(hoursLabel([23, 0])).toBe('23時〜翌1時')
  })

  it('夜をまたぐ時間と別の時間が混ざっても分かれる', () => {
    expect(hoursLabel([0, 1, 12, 23])).toBe('12時台・23時〜翌2時')
  })

  it('選んでいないときは「未選択」', () => {
    expect(hoursLabel([])).toBe('未選択')
  })
})

describe('toggleHour', () => {
  it('選んでいない時間を足すと、小さい順に並ぶ', () => {
    expect(toggleHour([9, 11], 10)).toEqual([9, 10, 11])
  })

  it('選んである時間を外す', () => {
    expect(toggleHour([9, 10, 11], 10)).toEqual([9, 11])
  })

  it('終日から1時間外すと、その時間だけ抜けた23時間になる', () => {
    const result = toggleHour(null, 3)
    expect(result).toHaveLength(23)
    expect(result).not.toContain(3)
  })

  it('24時間そろったら終日に戻る', () => {
    expect(toggleHour(ALL_HOURS.filter((h) => h !== 3), 3)).toBeNull()
  })

  it('最後の1つを外すと空（書きかけ）になる', () => {
    expect(toggleHour([9], 9)).toEqual([])
  })
})

describe('比べるための整え方', () => {
  it('並びや重なりが違っても、同じ時間なら同じ', () => {
    expect(sameHours([10, 9, 9], [9, 10])).toBe(false) // 整える前は別物
    expect(sameHours(normalizeHours([10, 9, 9]), normalizeHours([9, 10]))).toBe(true)
  })

  it('終日は null と24時間ぜんぶが同じ', () => {
    expect(sameHours(normalizeHours(ALL_HOURS), null)).toBe(true)
  })
})

describe('HOUR_PRESETS', () => {
  it('どれも0〜23の中で、重ならない', () => {
    const all = HOUR_PRESETS.flatMap((p) => p.hours)
    expect(new Set(all).size).toBe(all.length)
    expect(all.every((h) => h >= 0 && h <= 23)).toBe(true)
  })

  it('ぜんぶ合わせると24時間になる（抜けがない）', () => {
    expect(HOUR_PRESETS.flatMap((p) => p.hours).sort((a, b) => a - b)).toEqual(ALL_HOURS)
  })
})
