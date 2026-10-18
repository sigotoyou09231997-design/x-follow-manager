import { describe, expect, it } from 'vitest'
import {
  ALL_HOURS,
  HOUR_PRESETS,
  circularSegments,
  daySegments,
  endChoices,
  hoursLabel,
  hoursToRanges,
  normalizeHours,
  ownersByHour,
  rangeHours,
  rangeLabel,
  rangesToHours,
  sameHours,
  segmentHas,
  segmentLabel,
} from './hours'

describe('hoursLabel', () => {
  it('null と24時間ぜんぶは「終日」', () => {
    expect(hoursLabel(null)).toBe('終日')
    expect(hoursLabel(ALL_HOURS)).toBe('終日')
  })

  it('つながった時間は1つにまとめる', () => {
    expect(hoursLabel([9, 10, 11])).toBe('9時〜12時')
    expect(hoursLabel([21, 22, 23])).toBe('21時〜24時')
  })

  it('1時間だけのときは「○時台」', () => {
    expect(hoursLabel([9])).toBe('9時台')
  })

  it('離れた時間は「・」でつなぐ', () => {
    expect(hoursLabel([7, 8, 12, 13])).toBe('7時〜9時・12時〜14時')
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

describe('範囲（◯時から◯時まで）', () => {
  it('開始は含み、終了は含まない', () => {
    expect(rangeHours({ from: 9, to: 12 })).toEqual([9, 10, 11])
    expect(rangeHours({ from: 23, to: 24 })).toEqual([23])
  })

  it('終了が開始以下なら夜をまたぐ', () => {
    expect(rangeHours({ from: 22, to: 2 })).toEqual([22, 23, 0, 1])
    expect(rangeHours({ from: 20, to: 24 })).toEqual([20, 21, 22, 23])
  })

  it('範囲を時間にする。重なりは1つにまとめ、24時間ぜんぶは終日', () => {
    expect(rangesToHours([{ from: 9, to: 12 }, { from: 11, to: 14 }])).toEqual([9, 10, 11, 12, 13])
    expect(rangesToHours([{ from: 6, to: 24 }, { from: 0, to: 6 }])).toBeNull()
    expect(rangesToHours([])).toEqual([])
  })

  it('時間を範囲に分ける。0時と23時がつながるときは夜をまたぐ1つにする', () => {
    expect(hoursToRanges([7, 8, 12, 13])).toEqual([{ from: 7, to: 9 }, { from: 12, to: 14 }])
    expect(hoursToRanges([22, 23, 0, 1, 2])).toEqual([{ from: 22, to: 3 }])
    expect(hoursToRanges(null)).toEqual([])
  })

  it('範囲 → 時間 → 範囲 と往復しても同じ', () => {
    for (const r of [{ from: 9, to: 12 }, { from: 22, to: 6 }, { from: 0, to: 5 }, { from: 23, to: 24 }]) {
      expect(hoursToRanges(rangesToHours([r]))).toEqual([r])
    }
  })

  it('終了に選べるのは、開始の次の時から翌日の開始の1時間前まで（23通り。開始と同じ時は選べない）', () => {
    const c = endChoices(22)
    expect(c).toHaveLength(23)
    expect(c[0]).toEqual({ to: 23, nextDay: false })
    expect(c[1]).toEqual({ to: 24, nextDay: false })
    expect(c[2]).toEqual({ to: 1, nextDay: true })
    expect(c.at(-1)).toEqual({ to: 21, nextDay: true })
    expect(c.some((x) => x.to === 22)).toBe(false)
    expect(endChoices(0).at(-1)).toEqual({ to: 23, nextDay: false }) // 0時開始に 24 は選べない（終日になる）
  })

  it('「9時〜12時」「22時〜翌6時」', () => {
    expect(rangeLabel({ from: 9, to: 12 })).toBe('9時〜12時')
    expect(rangeLabel({ from: 22, to: 6 })).toBe('22時〜翌6時')
    expect(rangeLabel({ from: 20, to: 24 })).toBe('20時〜24時')
  })
})

describe('1日の使われ方（サーバーの選び方と同じ）', () => {
  it('時間を決めた文が当たればそれだけ、無ければ時間なしの文、それも無ければ休み', () => {
    const owners = ownersByHour([[6, 7], null], false)
    expect(owners[6]).toEqual([0])
    expect(owners[12]).toEqual([1])
    expect(ownersByHour([[6, 7]], false)[12]).toEqual([])
  })

  it('Yay は当たった文の先頭の1つだけ', () => {
    expect(ownersByHour([null, null], true)[3]).toEqual([0])
    expect(ownersByHour([null, null], false)[3]).toEqual([0, 1])
  })

  it('同じ文が続く時間をひとつの帯にまとめる', () => {
    const segs = daySegments(ownersByHour([[6, 7, 8], null], true))
    expect(segs).toEqual([
      { from: 0, length: 6, owners: [1] },
      { from: 6, length: 3, owners: [0] },
      { from: 9, length: 15, owners: [1] },
    ])
  })

  it('休みの時間も帯になる', () => {
    expect(daySegments(ownersByHour([[9, 10]], true)).map((s) => s.owners)).toEqual([[], [0], []])
  })
})

describe('夜をまたぐ区間', () => {
  // 1つ目 22時〜翌5時、2つ目 9時〜20時。5〜9時と20〜22時はどの文も使われない（休み）
  const owners = ownersByHour([[22, 23, 0, 1, 2, 3, 4], [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]], true)

  it('0時をまたいで同じ文が続く区間は1つにまとめる。並びは開始の時刻順', () => {
    expect(circularSegments(owners)).toEqual([
      { from: 5, length: 4, owners: [] },
      { from: 9, length: 11, owners: [1] },
      { from: 20, length: 2, owners: [] },
      { from: 22, length: 7, owners: [0] },
    ])
  })

  it('同じ文が丸1日続くなら、区間は1つ', () => {
    expect(circularSegments(ownersByHour([null], true))).toEqual([{ from: 0, length: 24, owners: [0] }])
  })

  it('区間の表示。夜をまたぐものは「翌」、丸1日は「終日」', () => {
    const segs = circularSegments(owners)
    expect(segs.map(segmentLabel)).toEqual(['5時〜9時', '9時〜20時', '20時〜22時', '22時〜翌5時'])
    expect(segmentLabel({ from: 0, length: 24, owners: [0] })).toBe('終日')
  })

  it('いまの時が入っている区間を見つけられる（夜をまたぐ区間も）', () => {
    const segs = circularSegments(owners)
    expect(segs.findIndex((s) => segmentHas(s, 8))).toBe(0)
    expect(segs.findIndex((s) => segmentHas(s, 9))).toBe(1)
    expect(segs.findIndex((s) => segmentHas(s, 3))).toBe(3) // 0時台〜4時台は、22時から続く区間
    expect(segs.findIndex((s) => segmentHas(s, 23))).toBe(3)
  })
})
