// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { activeIndexesAt, applySave, cleanHours, DocError, hourInJapan, scheduleAt } from './autopostDoc.js'

// 日本時間の「時」を作る（UTC+9）。Vercel の時計は UTC なので、ずれていないかをここで見る
const jst = (hour: number) => new Date(Date.UTC(2026, 9, 18, (hour - 9 + 24) % 24, 30))

describe('時間帯の整え方', () => {
  it('null は終日。小さい順に並べ、重なりを除く', () => {
    expect(cleanHours([null, [10, 9, 9]], 2)).toEqual([null, [9, 10]])
  })

  it('24時間ぜんぶは終日に直す', () => {
    expect(cleanHours([Array.from({ length: 24 }, (_, i) => i)], 1)).toEqual([null])
  })

  it('文の数と合わない・空・範囲外は受けない', () => {
    expect(() => cleanHours([null], 2)).toThrow(DocError)
    expect(() => cleanHours([[]], 1)).toThrow('時間を1つ以上選ぶか')
    expect(() => cleanHours([[24]], 1)).toThrow(DocError)
    expect(() => cleanHours([['9']], 1)).toThrow(DocError)
  })
})

describe('保存（applySave）', () => {
  const current = { messages: ['朝', '夜'], hours: [[6, 7] as number[] | null, null], archive: [] }

  it('時間帯を添えて保存できる', () => {
    expect(applySave(current, ['朝', '昼'], 10, [[6, 7], [12]])).toEqual({
      messages: ['朝', '昼'],
      hours: [[6, 7], [12]],
      archive: ['夜'],
    })
  })

  it('時間帯を知らない古い画面からの保存は、同じ文の時間帯を引き継ぐ（黙って終日に戻さない）', () => {
    expect(applySave(current, ['夜', '朝', '新'], 10).hours).toEqual([null, [6, 7], null])
  })
})

describe('いまの「時」', () => {
  it('Vercel（UTC）の時計からでも日本時間の時を出す', () => {
    expect(hourInJapan(new Date('2026-10-18T00:30:00Z'))).toBe(9)
    expect(hourInJapan(new Date('2026-10-18T15:30:00Z'))).toBe(0)
    expect(hourInJapan(new Date('2026-10-18T23:30:00Z'))).toBe(8)
  })
})

describe('その時間に使う文', () => {
  it('時間を決めた文が当たれば、その文だけ。当たらなければ終日の文', () => {
    const hours = [[6, 7], null, [6, 20]]
    expect(activeIndexesAt(hours, 6)).toEqual([0, 2])
    expect(activeIndexesAt(hours, 7)).toEqual([0])
    expect(activeIndexesAt(hours, 12)).toEqual([1])
  })

  it('終日の文が無く、当たる文も無い時間は空（投稿を休む）', () => {
    expect(activeIndexesAt([[6, 7]], 3)).toEqual([])
  })

  it('時間帯を決めていなければ、全部の文をこれまでどおり順に', () => {
    expect(activeIndexesAt([null, null], 3)).toEqual([0, 1])
  })
})

describe('scheduleAt', () => {
  it('休んでいる時間は idle と、次に始まる時刻', () => {
    expect(scheduleAt('discord', [[6, 7], [22]], jst(3))).toEqual({ hour: 3, activeIndexes: [], idle: true, nextHour: 6 })
    expect(scheduleAt('discord', [[6, 7], [22]], jst(23))).toMatchObject({ idle: true, nextHour: 6 }) // 日をまたぐ
  })

  it('文がまだ無いときは idle ではない（「文が無い」は別の知らせ）', () => {
    expect(scheduleAt('discord', [], jst(3))).toMatchObject({ activeIndexes: [], idle: false, nextHour: null })
  })

  it('yay は当たった文のうち先頭の1つだけ', () => {
    expect(scheduleAt('yay', [null, null], jst(12)).activeIndexes).toEqual([0])
    expect(scheduleAt('yay', [[12], [12]], jst(12)).activeIndexes).toEqual([0])
    expect(scheduleAt('discord', [null, null], jst(12)).activeIndexes).toEqual([0, 1])
  })
})
