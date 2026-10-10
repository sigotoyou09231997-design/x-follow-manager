import { describe, expect, it } from 'vitest'
import { localDate, localMonth, normalizeSettings, planSlots } from './slots'
import { DEFAULT_SETTINGS, type AutopilotSettings } from './types'

const settings = (patch: Partial<AutopilotSettings> = {}): AutopilotSettings => ({ ...DEFAULT_SETTINGS, ...patch })
// 2026-10-10 12:00 JST
const NOON_JST = new Date('2026-10-10T03:00:00.000Z')
const jstHm = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

describe('設定を使える形に直す', () => {
  it('範囲外は範囲内へ、形の違うものは既定へ戻す', () => {
    const n = normalizeSettings({ postsPerDay: 99, horizonDays: 0, monthlyBudgetYen: 1, windowStart: '25:99', timeZone: 'Mars/Base' })
    expect(n.postsPerDay).toBe(8)
    expect(n.horizonDays).toBe(1)
    expect(n.monthlyBudgetYen).toBe(300)
    expect(n.windowStart).toBe('08:00')
    expect(n.timeZone).toBe('Asia/Tokyo')
  })

  it('何も無ければ既定。品質は standard / saver だけ', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ quality: 'saver' }).quality).toBe('saver')
    expect(normalizeSettings({ quality: 'xxx' as never }).quality).toBe('standard')
  })

  it('時間帯が逆・狭すぎるときは既定の時間帯に戻す', () => {
    expect(normalizeSettings({ windowStart: '20:00', windowEnd: '10:00' })).toMatchObject({ windowStart: '08:00', windowEnd: '23:00' })
    expect(normalizeSettings({ windowStart: '10:00', windowEnd: '10:30' })).toMatchObject({ windowStart: '08:00', windowEnd: '23:00' })
  })

  it('投稿数は時間帯に収まる数まで（間隔の下限30分があるので、2時間に8本は入らない）', () => {
    const n = normalizeSettings({ postsPerDay: 8, windowStart: '10:00', windowEnd: '12:00' })
    expect(n.postsPerDay).toBe(4)
  })
})

describe('投稿の枠', () => {
  it('今日の残りと明日（horizonDays=2）を、1日 postsPerDay 本ずつ、早い順に返す', () => {
    const slots = planSlots(NOON_JST, settings({ postsPerDay: 3, horizonDays: 2 }))
    const days = new Set(slots.map((s) => s.key.slice(0, 10)))
    expect([...days]).toEqual(['2026-10-10', '2026-10-11'])
    expect(slots.filter((s) => s.key.startsWith('2026-10-11'))).toHaveLength(3)
    // 今日は12時を過ぎているので、残りの枠だけ（8〜23時を3等分した真ん中は 10:30 / 15:30 / 20:30 あたり）
    expect(slots.filter((s) => s.key.startsWith('2026-10-10')).every((s) => new Date(s.at) > NOON_JST)).toBe(true)
    expect(slots.map((s) => s.at)).toEqual([...slots.map((s) => s.at)].sort())
  })

  it('同じ入力なら何度計算しても同じ（二重に作らないため）', () => {
    expect(planSlots(NOON_JST, settings())).toEqual(planSlots(NOON_JST, settings()))
  })

  it('時間帯の中に収まり、枠と枠は30分以上あく', () => {
    for (const perDay of [1, 3, 5, 8]) {
      const slots = planSlots(new Date('2026-10-10T15:00:00.000Z'), settings({ postsPerDay: perDay, horizonDays: 3 })) // 翌0:00 JST から
      const byDay = new Map<string, number[]>()
      for (const s of slots) byDay.set(s.key.slice(0, 10), [...(byDay.get(s.key.slice(0, 10)) ?? []), jstHm(s.at)])
      for (const minutes of byDay.values()) {
        expect(minutes).toHaveLength(perDay)
        for (const m of minutes) {
          expect(m).toBeGreaterThanOrEqual(8 * 60)
          expect(m).toBeLessThanOrEqual(23 * 60)
        }
        for (let i = 1; i < minutes.length; i++) expect(minutes[i] - minutes[i - 1]).toBeGreaterThanOrEqual(30)
      }
    }
  })

  it('毎日同じ時刻にはならない（日付ごとにずれる）', () => {
    const slots = planSlots(new Date('2026-10-10T15:00:00.000Z'), settings({ postsPerDay: 1, horizonDays: 3 }))
    const times = slots.map((s) => jstHm(s.at))
    expect(new Set(times).size).toBeGreaterThan(1)
  })

  it('5分以内に迫った枠・過去の枠は作らない', () => {
    // 20:28 JST: 20:30 あたりの枠は近すぎる
    const now = new Date('2026-10-10T11:28:00.000Z')
    const slots = planSlots(now, settings({ postsPerDay: 3, horizonDays: 1 }))
    for (const s of slots) expect(new Date(s.at).getTime()).toBeGreaterThanOrEqual(now.getTime() + 5 * 60_000)
  })

  it('月末をまたいでも暦どおりに進む', () => {
    const slots = planSlots(new Date('2026-10-31T15:00:00.000Z'), settings({ postsPerDay: 1, horizonDays: 2 })) // 11/1 0:00 JST
    expect(slots.map((s) => s.key.slice(0, 10))).toEqual(['2026-11-01', '2026-11-02'])
  })

  it('タイムゾーンを変えれば、その地域の時刻で並ぶ', () => {
    const slots = planSlots(new Date('2026-10-10T00:00:00.000Z'), settings({ postsPerDay: 1, horizonDays: 2, timeZone: 'America/New_York' })) // 現地は 10/9 の夜。今日の枠は過ぎている
    const hour = Number(new Date(slots[0].at).toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }))
    expect(hour).toBeGreaterThanOrEqual(8)
    expect(hour).toBeLessThanOrEqual(23)
  })
})

describe('その地域の日付・月', () => {
  it('UTC の日付ではなく、設定の地域の日付で数える', () => {
    const t = new Date('2026-10-31T16:30:00.000Z').getTime() // JST では 11/1 1:30
    expect(localDate(t, 'Asia/Tokyo')).toBe('2026-11-01')
    expect(localMonth(t, 'Asia/Tokyo')).toBe('2026-11')
    expect(localMonth(t, 'UTC')).toBe('2026-10')
  })
})
