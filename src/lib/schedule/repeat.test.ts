import { describe, expect, it } from 'vitest'
import { describeRepeatRule, nextOccurrence, zonedTimeToUtc } from './repeat'
import type { RepeatRule } from './types'

const JST = 'Asia/Tokyo'

describe('zonedTimeToUtc', () => {
  it('JSTのローカル時刻をUTC瞬間に変換する', () => {
    // 2026-08-24 09:00 JST = 2026-08-24 00:00 UTC
    const ts = zonedTimeToUtc(2026, 8, 24, 9, 0, JST)
    expect(new Date(ts).toISOString()).toBe('2026-08-24T00:00:00.000Z')
  })

  it('夏時間のある地域でもオフセットを取り違えない', () => {
    // ニューヨークは3月8日に夏時間入り。3月1日はEST(-5)、3月15日はEDT(-4)。
    const winter = zonedTimeToUtc(2026, 3, 1, 9, 0, 'America/New_York')
    const summer = zonedTimeToUtc(2026, 3, 15, 9, 0, 'America/New_York')
    expect(new Date(winter).toISOString()).toBe('2026-03-01T14:00:00.000Z')
    expect(new Date(summer).toISOString()).toBe('2026-03-15T13:00:00.000Z')
  })
})

describe('nextOccurrence', () => {
  const anchor = '2026-08-22T00:00:00.000Z' // 2026-08-22 09:00 JST (土)

  it('毎日: 次の該当時刻を返す', () => {
    const rule: RepeatRule = { freq: 'daily', interval: 1, time: '09:00', timeZone: JST }
    // 2026-08-24 03:00 JST 時点 → 同日9:00がまだ来ていないので当日を返す
    const next = nextOccurrence(rule, '2026-08-23T18:00:00.000Z', anchor)
    expect(next).toBe('2026-08-24T00:00:00.000Z')
  })

  it('毎日: すでにその日の時刻を過ぎていたら翌日になる', () => {
    const rule: RepeatRule = { freq: 'daily', interval: 1, time: '09:00', timeZone: JST }
    const next = nextOccurrence(rule, '2026-08-24T00:00:00.000Z', anchor)
    expect(next).toBe('2026-08-25T00:00:00.000Z')
  })

  it('隔日: アンカーから偶数日だけを選ぶ', () => {
    const rule: RepeatRule = { freq: 'daily', interval: 2, time: '09:00', timeZone: JST }
    // アンカーは8/22。8/23はスキップされ8/24になる
    const next = nextOccurrence(rule, '2026-08-22T01:00:00.000Z', anchor)
    expect(next).toBe('2026-08-24T00:00:00.000Z')
  })

  it('毎週 月・水: 指定曜日のみ返す', () => {
    const rule: RepeatRule = {
      freq: 'weekly',
      interval: 1,
      byWeekday: [1, 3],
      time: '09:00',
      timeZone: JST,
    }
    // 2026-08-22(土)の直後 → 次は8/24(月)
    const first = nextOccurrence(rule, anchor, anchor)
    expect(first).toBe('2026-08-24T00:00:00.000Z')
    // 8/24(月)の直後 → 次は8/26(水)
    const second = nextOccurrence(rule, first!, anchor)
    expect(second).toBe('2026-08-26T00:00:00.000Z')
  })

  it('隔週: アンカー週から偶数週だけ選ぶ', () => {
    const rule: RepeatRule = {
      freq: 'weekly',
      interval: 2,
      byWeekday: [1],
      time: '09:00',
      timeZone: JST,
    }
    // アンカー週(8/16-8/22)の月曜は既に過ぎているので、次は2週後の週の月曜=8/31
    const next = nextOccurrence(rule, anchor, anchor)
    expect(next).toBe('2026-08-31T00:00:00.000Z')
  })

  it('毎月: 指定日に一致する日を返し、存在しない月は飛ばす', () => {
    const rule: RepeatRule = {
      freq: 'monthly',
      interval: 1,
      byMonthday: 31,
      time: '09:00',
      timeZone: JST,
    }
    // 8/31の次は9/31が存在しないので10/31になる
    const first = nextOccurrence(rule, anchor, anchor)
    expect(first).toBe('2026-08-31T00:00:00.000Z')
    const second = nextOccurrence(rule, first!, anchor)
    expect(second).toBe('2026-10-31T00:00:00.000Z')
  })

  it('until を過ぎたら undefined を返す', () => {
    const rule: RepeatRule = {
      freq: 'daily',
      interval: 1,
      time: '09:00',
      timeZone: JST,
      until: '2026-08-25',
    }
    expect(nextOccurrence(rule, '2026-08-25T00:00:00.000Z', anchor)).toBeUndefined()
  })
})

describe('describeRepeatRule', () => {
  it('日本語の説明文を作る', () => {
    expect(
      describeRepeatRule({ freq: 'weekly', interval: 1, byWeekday: [1, 3], time: '09:00', timeZone: JST })
    ).toBe('毎週 月・水曜 09:00')
    expect(describeRepeatRule({ freq: 'daily', interval: 2, time: '20:30', timeZone: JST })).toBe(
      '2日ごと 20:30'
    )
    expect(
      describeRepeatRule({ freq: 'monthly', interval: 1, byMonthday: 1, time: '08:00', timeZone: JST })
    ).toBe('毎月 1日 08:00')
  })
})
