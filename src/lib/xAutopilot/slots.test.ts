import { describe, expect, it } from 'vitest'
import { localDate, localMonth, normalizeSettings, planSlots, settingsProblems } from './slots'
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

describe('設定が成り立つか（直さずに理由を返す）', () => {
  it('既定の設定・保存済みの設定は問題なし', () => {
    expect(settingsProblems(DEFAULT_SETTINGS)).toEqual([])
    expect(settingsProblems(normalizeSettings({ postsPerDay: 2, windowStart: '10:00', windowEnd: '20:00' }))).toEqual([])
  })

  it('一部の項目だけでも調べられる（無い項目は調べない）', () => {
    expect(settingsProblems({ quality: 'saver' })).toEqual([])
    expect(settingsProblems({ postsPerDay: 2 })).toEqual([])
  })

  it('時間帯: 空・形が違う・終わりが始めより前・1時間未満は断る', () => {
    expect(settingsProblems({ windowStart: '', windowEnd: '23:00' })[0]).toMatch(/時刻を入力/)
    expect(settingsProblems({ windowStart: '8:00', windowEnd: '23:00' })[0]).toMatch(/時刻を入力/)
    expect(settingsProblems({ windowStart: '20:00', windowEnd: '08:00' })[0]).toMatch(/1時間以上/)
    expect(settingsProblems({ windowStart: '08:00', windowEnd: '08:30' })[0]).toMatch(/1時間以上/)
    expect(settingsProblems({ windowStart: '08:00', windowEnd: '09:00' })).toEqual([])
  })

  it('回数: 範囲外・小数は断り、時間帯に入りきらない回数は入る回数を教える', () => {
    expect(settingsProblems({ postsPerDay: 0 })[0]).toMatch(/1〜8回/)
    expect(settingsProblems({ postsPerDay: 9 })[0]).toMatch(/1〜8回/)
    expect(settingsProblems({ postsPerDay: 1.5 })[0]).toMatch(/1〜8回/)
    // 8:00〜10:00 は 120分 ÷ 30分 = 4回まで。
    expect(settingsProblems({ windowStart: '08:00', windowEnd: '10:00', postsPerDay: 5 })[0]).toMatch(/1日4回までしか/)
    expect(settingsProblems({ windowStart: '08:00', windowEnd: '10:00', postsPerDay: 4 })).toEqual([])
  })

  it('日数・月の上限: 範囲外は断る', () => {
    expect(settingsProblems({ horizonDays: 0 })[0]).toMatch(/1〜3日/)
    expect(settingsProblems({ horizonDays: 4 })[0]).toMatch(/1〜3日/)
    expect(settingsProblems({ monthlyBudgetYen: 299 })[0]).toMatch(/300〜50,000円/)
    expect(settingsProblems({ monthlyBudgetYen: 50_001 })[0]).toMatch(/300〜50,000円/)
    expect(settingsProblems({ monthlyBudgetYen: Number.NaN })[0]).toMatch(/300〜50,000円/)
    expect(settingsProblems({ monthlyBudgetYen: 300 })).toEqual([])
  })

  it('複数の問題は、全部返す', () => {
    expect(settingsProblems({ postsPerDay: 20, horizonDays: 9 }).length).toBe(2)
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

describe('1日2回は午前中と午後', () => {
  // 2026-10-11 0:00 JST 以降の3日ぶん（今日の入れ直しが混ざらない）
  const FROM_MIDNIGHT = new Date('2026-10-10T15:00:00.000Z')

  it('午前＝始め〜12:00に1回、午後＝12:00〜18:00に1回（毎日）', () => {
    const slots = planSlots(FROM_MIDNIGHT, settings({ postsPerDay: 2, horizonDays: 3 }))
    expect(slots).toHaveLength(6)
    for (const s of slots) {
      const m = jstHm(s.at)
      if (s.key.endsWith('#0')) {
        expect(m).toBeGreaterThanOrEqual(8 * 60)
        expect(m).toBeLessThan(12 * 60)
      } else {
        expect(m).toBeGreaterThanOrEqual(12 * 60)
        expect(m).toBeLessThanOrEqual(18 * 60)
      }
    }
  })

  it('時間帯の終わりが18時より早ければ、午後はそこまで', () => {
    const slots = planSlots(FROM_MIDNIGHT, settings({ postsPerDay: 2, horizonDays: 3, windowEnd: '15:00' }))
    for (const s of slots.filter((x) => x.key.endsWith('#1'))) {
      expect(jstHm(s.at)).toBeGreaterThanOrEqual(12 * 60)
      expect(jstHm(s.at)).toBeLessThanOrEqual(15 * 60)
    }
  })

  it('午前や午後に収まらない時間帯（昼から夜だけ）は、等分に戻す', () => {
    const slots = planSlots(FROM_MIDNIGHT, settings({ postsPerDay: 2, horizonDays: 2, windowStart: '13:00', windowEnd: '22:00' }))
    expect(slots).toHaveLength(4)
    for (const s of slots) {
      expect(jstHm(s.at)).toBeGreaterThanOrEqual(13 * 60)
      expect(jstHm(s.at)).toBeLessThanOrEqual(22 * 60)
    }
    const day1 = slots.filter((s) => s.key.startsWith('2026-10-11')).map((s) => jstHm(s.at))
    expect(day1[1] - day1[0]).toBeGreaterThanOrEqual(30)
  })

  it('2回以外は、これまでどおり時間帯の等分', () => {
    const slots = planSlots(FROM_MIDNIGHT, settings({ postsPerDay: 3, horizonDays: 1 }))
    const minutes = slots.map((s) => jstHm(s.at))
    // 8〜23時を3等分した真ん中は 10:30 / 15:30 / 20:30。ずれは区間（5時間）の±30%まで。
    expect(Math.abs(minutes[0] - (10 * 60 + 30))).toBeLessThanOrEqual(90)
    expect(Math.abs(minutes[1] - (15 * 60 + 30))).toBeLessThanOrEqual(90)
    expect(Math.abs(minutes[2] - (20 * 60 + 30))).toBeLessThanOrEqual(90)
  })
})

describe('今日のぶん（時刻が過ぎた枠も、今日の残りに入れる）', () => {
  const at = (jst: string) => new Date(`2026-10-10T${jst}:00+09:00`)
  const todayOf = (slots: ReturnType<typeof planSlots>) => slots.filter((s) => s.key.startsWith('2026-10-10'))

  it('夜に始めても、過ぎた午前・午後の枠を今日の残りに入れ直す（余裕15分後〜時間帯の終わり、30分以上あけて）', () => {
    const now = at('20:46')
    const today = todayOf(planSlots(now, settings({ postsPerDay: 2, horizonDays: 1 })))
    expect(today.map((s) => s.key)).toEqual(['2026-10-10#0', '2026-10-10#1'])
    const [a, b] = today.map((s) => jstHm(s.at))
    expect(a).toBeGreaterThanOrEqual(21 * 60 + 1)
    expect(b).toBeLessThanOrEqual(23 * 60)
    expect(b - a).toBeGreaterThanOrEqual(30)
  })

  it('次の未来の枠があるときは、その手前（30分前まで）に収める', () => {
    const now = at('12:00')
    const slots = todayOf(planSlots(now, settings({ postsPerDay: 3, horizonDays: 1 })))
    expect(slots.map((s) => s.key)).toEqual(['2026-10-10#0', '2026-10-10#1', '2026-10-10#2'])
    const minutes = slots.map((s) => jstHm(s.at))
    expect(minutes[0]).toBeGreaterThanOrEqual(12 * 60 + 16)
    for (let i = 1; i < minutes.length; i++) expect(minutes[i] - minutes[i - 1]).toBeGreaterThanOrEqual(30)
  })

  it('残りの時間に入りきらない分は作らない（翌日へずらさない）', () => {
    const now = at('22:20') // 余裕をおくと 22:36〜23:00 の24分しかない
    const today = todayOf(planSlots(now, settings({ postsPerDay: 2, horizonDays: 1 })))
    expect(today).toHaveLength(1)
    expect(jstHm(today[0].at)).toBeGreaterThanOrEqual(22 * 60 + 36)
    expect(jstHm(today[0].at)).toBeLessThanOrEqual(23 * 60)
  })

  it('時間帯の終わりを過ぎていれば、今日のぶんは無い', () => {
    expect(todayOf(planSlots(at('22:50'), settings({ postsPerDay: 2, horizonDays: 1 })))).toEqual([])
    expect(todayOf(planSlots(at('23:30'), settings({ postsPerDay: 2, horizonDays: 2 })))).toEqual([])
  })

  it('時間帯の始めより前（早朝）なら、入れ直さず本来の時刻で並べる', () => {
    const today = todayOf(planSlots(at('06:00'), settings({ postsPerDay: 2, horizonDays: 1 })))
    expect(today).toHaveLength(2)
    expect(jstHm(today[0].at)).toBeLessThan(12 * 60)
    expect(jstHm(today[1].at)).toBeGreaterThanOrEqual(12 * 60)
  })

  it('時間が進んで再計算しても、先に作った枠と30分以上あく（入れ直しの位置が動いても詰まらない）', () => {
    const base = settings({ postsPerDay: 2, horizonDays: 1 })
    const start = at('20:46')
    const first = todayOf(planSlots(start, base)).find((s) => s.key.endsWith('#0'))!
    for (let minutes = 0; minutes <= 75; minutes++) {
      const now = new Date(start.getTime() + minutes * 60_000)
      const second = todayOf(planSlots(now, base)).find((s) => s.key.endsWith('#1'))
      if (!second) continue
      expect(new Date(second.at).getTime() - new Date(first.at).getTime()).toBeGreaterThanOrEqual(30 * 60_000)
    }
  })

  it('同じ入力なら何度計算しても同じ', () => {
    const now = at('20:46')
    expect(planSlots(now, settings({ postsPerDay: 2 }))).toEqual(planSlots(now, settings({ postsPerDay: 2 })))
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
