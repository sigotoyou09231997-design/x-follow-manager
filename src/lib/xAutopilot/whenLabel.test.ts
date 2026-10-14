import { describe, expect, it } from 'vitest'
import { whenParts } from './whenLabel'

// 2026-10-15 12:00（日本時間）= 03:00Z
const NOW = Date.parse('2026-10-15T03:00:00.000Z')
const TZ = 'Asia/Tokyo'
const jst = (md: string, hm: string) => new Date(`2026-${md}T${hm}:00+09:00`).toISOString()

describe('予約の投稿時刻の見せ方', () => {
  it('同じ日は「今日」、次の日は「明日」、それより先は「月/日(曜)」', () => {
    expect(whenParts(jst('10-15', '14:16'), TZ, NOW)).toMatchObject({ day: '今日', time: '14:16' })
    expect(whenParts(jst('10-16', '10:58'), TZ, NOW)).toMatchObject({ day: '明日', time: '10:58' })
    expect(whenParts(jst('10-17', '09:05'), TZ, NOW)).toMatchObject({ day: '10/17(土)', time: '09:05' })
  })

  it('日付の境目は、設定の地域の日付で数える（UTC では同じ日でも、日本時間では翌日）', () => {
    const lateNight = Date.parse('2026-10-15T14:30:00.000Z') // 日本時間 23:30
    expect(whenParts('2026-10-15T15:30:00.000Z', TZ, lateNight)).toMatchObject({ day: '明日', time: '00:30' })
  })

  it('1日以内なら「あと◯時間◯分」。ぴったりの時間は分を省く。1分に満たない・過ぎたものは空', () => {
    expect(whenParts(jst('10-15', '12:35'), TZ, NOW)?.rel).toBe('あと35分')
    expect(whenParts(jst('10-15', '14:30'), TZ, NOW)?.rel).toBe('あと2時間30分')
    expect(whenParts(jst('10-15', '15:00'), TZ, NOW)?.rel).toBe('あと3時間')
    expect(whenParts(jst('10-15', '11:00'), TZ, NOW)?.rel).toBe('') // 過ぎている
    expect(whenParts(jst('10-17', '12:00'), TZ, NOW)?.rel).toBe('') // 1日以上先
  })

  it('時刻が無い・読めないときは null', () => {
    expect(whenParts(undefined, TZ, NOW)).toBeNull()
    expect(whenParts('いつか', TZ, NOW)).toBeNull()
  })
})
