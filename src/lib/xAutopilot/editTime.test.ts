import { describe, expect, it } from 'vitest'
import { fromInputValue, toInputValue } from './editTime'

describe('自動運転の予約の時刻の出し入れ（設定の地域の時刻で）', () => {
  it('UTC の時刻を、日本時間の入力欄の値にする', () => {
    expect(toInputValue('2026-10-15T03:30:00.000Z', 'Asia/Tokyo')).toBe('2026-10-15T12:30')
    expect(toInputValue('2026-10-15T16:05:00.000Z', 'Asia/Tokyo')).toBe('2026-10-16T01:05') // 日付をまたぐ
  })

  it('入力欄の値を、UTC の時刻にする', () => {
    expect(fromInputValue('2026-10-15T12:30', 'Asia/Tokyo')).toBe('2026-10-15T03:30:00.000Z')
    expect(fromInputValue('2026-10-16T01:05', 'Asia/Tokyo')).toBe('2026-10-15T16:05:00.000Z')
  })

  it('出して戻すと元の時刻になる（端末の時差に左右されない）', () => {
    const iso = '2026-10-15T07:45:00.000Z'
    expect(fromInputValue(toInputValue(iso, 'Asia/Tokyo'), 'Asia/Tokyo')).toBe(iso)
    expect(fromInputValue(toInputValue(iso, 'America/New_York'), 'America/New_York')).toBe(iso)
  })

  it('読めない値は null（黙って別の時刻にしない）', () => {
    expect(fromInputValue('', 'Asia/Tokyo')).toBeNull()
    expect(fromInputValue('明日の昼', 'Asia/Tokyo')).toBeNull()
    expect(fromInputValue('2026-10-15 12:30', 'Asia/Tokyo')).toBeNull()
  })
})
