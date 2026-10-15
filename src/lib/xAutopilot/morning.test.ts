import { describe, expect, it } from 'vitest'
import { isLateMorningSlot, morningWindow } from './morning'

const TZ = 'Asia/Tokyo'
const jst = (hm: string, day = '2026-10-15') => new Date(`${day}T${hm}:00+09:00`).toISOString()
const NOW = new Date(jst('08:58')).getTime()

describe('今日の午前中の枠（朝を過ぎてからは作らない）', () => {
  it('朝（6時以降）に、今日の午前中の枠は対象。午後・明日の枠は対象外', () => {
    expect(isLateMorningSlot(jst('11:30'), NOW, TZ)).toBe(true)
    expect(isLateMorningSlot(jst('08:54'), NOW, TZ)).toBe(true)
    expect(isLateMorningSlot(jst('12:00'), NOW, TZ)).toBe(false)
    expect(isLateMorningSlot(jst('15:20'), NOW, TZ)).toBe(false)
    expect(isLateMorningSlot(jst('08:12', '2026-10-16'), NOW, TZ)).toBe(false)
  })

  it('まだ朝の前（6時前）は、今日の午前中の枠も作ってよい', () => {
    expect(isLateMorningSlot(jst('08:54'), new Date(jst('05:30')).getTime(), TZ)).toBe(false)
  })

  it('日付の境目は、設定の地域で数える（UTC では前日でも、日本時間では今日）', () => {
    // 2026-10-14T23:30Z = 日本時間 10/15 08:30
    const now = Date.parse('2026-10-14T23:30:00.000Z')
    expect(isLateMorningSlot('2026-10-15T01:30:00.000Z', now, TZ)).toBe(true) // 日本時間 10:30
  })
})

describe('取り消す対象の範囲', () => {
  it('朝なら、今日の0時〜正午の時刻で、朝6時以降に作られたものが対象', () => {
    expect(morningWindow(NOW, TZ)).toEqual({ scheduledFrom: jst('00:00'), scheduledTo: jst('12:00'), createdAfter: jst('06:00') })
  })

  it('6時前は対象なし', () => {
    expect(morningWindow(new Date(jst('05:59')).getTime(), TZ)).toBeNull()
  })
})
