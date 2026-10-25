import { describe, expect, it } from 'vitest'
import { APPROVE_LEAD_MS, MIN_POST_GAP_MS, lastPostedAt, nextApprovalWindow, pickApprovalTime, postsOnDay, soonestApprovalTime } from './approve'

const NOW = Date.parse('2026-10-15T01:00:00.000Z')
const at = (min: number) => new Date(NOW + min * 60_000).toISOString()
const post = (id: string, status: string, min: number) => ({ id, status, scheduledAt: at(min) })

describe('投稿可能にしたときの投稿時刻', () => {
  it('これより前の投稿可能な予約が無ければ、いまから猶予ぶん先に前倒しする', () => {
    const target = post('b', 'draft', 300)
    const others = [post('a', 'draft', 60), post('c', 'scheduled', 600)] // 前にあるのは確認待ちだけ。投稿可能は後ろ
    expect(soonestApprovalTime(target, others, NOW)).toBe(new Date(NOW + APPROVE_LEAD_MS).toISOString())
  })

  it('これより前の投稿可能な予約があれば、時刻はそのまま（その後ろに並ぶ）', () => {
    const target = post('b', 'draft', 300)
    const others = [post('a', 'scheduled', 60)]
    expect(soonestApprovalTime(target, others, NOW)).toBeUndefined()
  })

  it('取り消し・投稿済みなど、投稿可能でないものは前にあっても数えない', () => {
    const target = post('b', 'draft', 300)
    const others = [post('a', 'canceled', 60), post('x', 'posted', 30), post('y', 'failed', 20)]
    expect(soonestApprovalTime(target, others, NOW)).toBeDefined()
  })

  it('もうすぐ出る時刻・過ぎた時刻は、動かさない（これ以上は前倒しできない）', () => {
    expect(soonestApprovalTime(post('b', 'draft', 2), [], NOW)).toBeUndefined()
    expect(soonestApprovalTime(post('b', 'draft', -30), [], NOW)).toBeUndefined()
  })

  it('自分自身は、前にある予約に数えない。時刻の無い予約は何もしない', () => {
    const target = post('b', 'scheduled', 300)
    expect(soonestApprovalTime(target, [target], NOW)).toBeDefined()
    expect(soonestApprovalTime({ id: 'z', status: 'draft' }, [], NOW)).toBeUndefined()
  })
})

describe('直前の投稿から、最低限の間隔をあける', () => {
  it('直前に出した投稿が近ければ、前倒し先は、その投稿から最低間隔あとにする', () => {
    const target = post('b', 'draft', 300)
    const posted = post('p', 'posted', -10) // 10分前に出した
    expect(soonestApprovalTime(target, [target, posted], NOW)).toBe(new Date(NOW - 10 * 60_000 + MIN_POST_GAP_MS).toISOString())
  })

  it('直前の投稿が十分前なら、いまから猶予ぶん先（間隔は気にしない）', () => {
    const target = post('b', 'draft', 300)
    const posted = post('p', 'posted', -120)
    expect(soonestApprovalTime(target, [target, posted], NOW)).toBe(new Date(NOW + APPROVE_LEAD_MS).toISOString())
  })

  it('出している途中（publishing）も、直前の投稿に数える', () => {
    expect(lastPostedAt([post('a', 'publishing', -3), post('b', 'posted', -50), post('c', 'scheduled', 20)])).toBe(NOW - 3 * 60_000)
    expect(lastPostedAt([post('c', 'scheduled', 20), post('d', 'draft', 5)])).toBeUndefined()
  })
})

describe('本人が時刻を決めた予約は、動かさない', () => {
  const fixed = (id: string, status: string, min: number) => ({ ...post(id, status, min), fixedTime: true })

  it('投稿可能にしても、前倒ししない', () => {
    expect(soonestApprovalTime(fixed('b', 'draft', 300), [], NOW)).toBeUndefined()
  })

})

describe('前に投稿可能な予約があるとき、列のすぐ後ろ（次に空いている枠）へ詰める', () => {
  const slot = (min: number) => NOW + min * 60_000

  it('遠い日の予約を投稿可能にすると、前の投稿可能な予約から最低間隔あけた、次の枠へ移す（明日の午前など）', () => {
    // 今日の夜（600分後）に投稿可能な予約がある。次の枠は、その30分以上あと（明日の午前＝1300分後）
    const target = post('sat', 'draft', 3000)
    const others = [post('tonight', 'scheduled', 600), post('later', 'scheduled', 3300)]
    const slots = [slot(400), slot(620), slot(1300), slot(1700), slot(2900)]
    expect(soonestApprovalTime(target, [target, ...others], NOW, slots)).toBe(new Date(slot(1300)).toISOString())
  })

  it('前の投稿可能な予約の「後」だけを見る（それより後ろの予約は、並びを塞がない）', () => {
    const target = post('b', 'draft', 3000)
    const others = [post('far', 'scheduled', 3500)] // 後ろにあるだけ → 前には無いので、いちばん早い扱い
    expect(soonestApprovalTime(target, [target, ...others], NOW, [slot(1300)])).toBe(new Date(NOW + APPROVE_LEAD_MS).toISOString())
  })

  it('次の枠がいまの時刻より遅い（すでに最短の位置）なら、動かさない', () => {
    const target = post('b', 'draft', 700)
    const others = [post('tonight', 'scheduled', 600)]
    expect(soonestApprovalTime(target, [target, ...others], NOW, [slot(1300), slot(1700)])).toBeUndefined()
  })

  it('枠の情報が無ければ（空）、動かさない。前の予約が近すぎれば、最低間隔あけた枠を選ぶ', () => {
    const target = post('b', 'draft', 3000)
    const others = [post('a', 'scheduled', 600)]
    expect(soonestApprovalTime(target, [target, ...others], NOW, [])).toBeUndefined()
    expect(soonestApprovalTime(target, [target, ...others], NOW, [slot(610), slot(640)])).toBe(new Date(slot(640)).toISOString()) // 610 は30分以内
  })
})

describe('1日の投稿数の上限（今日すでに上限まで出ているなら、今日に入れない）', () => {
  const CAP = { postsPerDay: 2, timeZone: 'Asia/Tokyo' }
  // NOW は日本時間 10:00（2026-10-15）。同じ日は +0〜+839分（23:59 まで）、翌日は +840分〜
  const slot = (min: number) => NOW + min * 60_000

  it('今日の投稿が上限に達している（出した1＋投稿可能1）とき、前倒し先は、次の日の枠', () => {
    const target = post('b', 'draft', 3000)
    const others = [post('done', 'posted', -120), post('tonight', 'scheduled', 600)] // 今日はすでに2本
    // 今日の枠（700分後＝21:40）はあるが、上限なので使わない。明日の枠（1000分後）へ
    const moved = soonestApprovalTime(target, [target, ...others], NOW, [slot(700), slot(1000), slot(2000)], CAP)
    expect(moved).toBe(new Date(slot(1000)).toISOString())
  })

  it('今日にまだ余裕があれば、これまでどおり（いますぐ側へ）', () => {
    const target = post('b', 'draft', 3000)
    const others = [post('done', 'posted', -120)] // 今日は1本だけ
    expect(soonestApprovalTime(target, [target, ...others], NOW, [slot(1000)], CAP)).toBe(new Date(NOW + APPROVE_LEAD_MS).toISOString())
  })
})

describe('postsOnDay', () => {
  it('日本時間の同じ日の、出した・出している・投稿可能だけを数える（確認待ち・取り消しは数えない。自分は除く）', () => {
    const cap = { postsPerDay: 3, timeZone: 'Asia/Tokyo' }
    const list = [post('a', 'posted', -100), post('b', 'scheduled', 200), post('c', 'draft', 100), post('d', 'canceled', 100), post('e', 'scheduled', 2000)]
    expect(postsOnDay(list, NOW, cap)).toBe(2)
    expect(postsOnDay(list, NOW, cap, 'a')).toBe(1)
  })
})

describe('午前に1回・午後に1回: 投稿可能にしたときの半日の決め方', () => {
  // 2026-10-15 10:00 JST（= 01:00Z）。午前の途中
  const settings = { windowStart: '08:00', windowEnd: '23:00', timeZone: 'Asia/Tokyo', postsPerDay: 3 }
  const jst = (day: number, h: number, m = 0) => Date.UTC(2026, 9, day, h - 9, m)
  const p = (id: string, status: string, ms: number) => ({ id, status, scheduledAt: new Date(ms).toISOString() })
  const target = { id: 't', status: 'draft', scheduledAt: new Date(jst(20, 9)).toISOString() }

  it('午前は7時〜12時。午前の途中なら、まず今日の午前の残り（いまから猶予あと〜12:00）', () => {
    const w = nextApprovalWindow(target, [], NOW, settings)
    expect(w?.part).toBe('morning')
    expect(w?.dayOffset).toBe(0)
    expect(w?.from).toBe(NOW + APPROVE_LEAD_MS)
    expect(w?.to).toBe(jst(15, 12))
  })

  it('午前にもう1本あれば、午後へ。午後にもあれば、明日の午前へ', () => {
    const morning = p('a', 'scheduled', jst(15, 11))
    expect(nextApprovalWindow(target, [morning], NOW, settings)?.part).toBe('afternoon')
    const w = nextApprovalWindow(target, [morning, p('b', 'scheduled', jst(15, 18))], NOW, settings)
    expect(w).toMatchObject({ part: 'morning', dayOffset: 1 })
    expect(w?.from).toBe(jst(16, 7))
  })

  it('確認待ち・取り消しは、半日を塞がない。投稿済みは塞ぐ', () => {
    expect(nextApprovalWindow(target, [p('a', 'draft', jst(15, 11)), p('b', 'canceled', jst(15, 11))], NOW, settings)?.part).toBe('morning')
    expect(nextApprovalWindow(target, [p('a', 'posted', jst(15, 9, 30))], NOW, settings)?.part).toBe('afternoon')
  })

  it('午前の予約が12:00ちょうど近くなら、午後の始まりは最低間隔ぶん後ろにずらす', () => {
    const w = nextApprovalWindow(target, [p('a', 'scheduled', jst(15, 11, 50))], NOW, settings)
    expect(w?.part).toBe('afternoon')
    expect(w?.from).toBe(jst(15, 11, 50) + MIN_POST_GAP_MS)
  })

  it('午後の遅い時間は、窓がもう狭ければ飛ばして翌日へ', () => {
    const late = jst(15, 22, 55)
    const w = nextApprovalWindow(target, [], late, settings)
    expect(w).toMatchObject({ part: 'morning', dayOffset: 1 })
  })

  it('1日の上限に達した日は飛ばす', () => {
    const cap1 = { ...settings, postsPerDay: 1 }
    const w = nextApprovalWindow(target, [p('a', 'scheduled', jst(15, 11))], NOW, cap1)
    expect(w?.dayOffset).toBe(1)
  })

  it('選ぶ時刻は半日の中に収まり、乱数で決まる', () => {
    const w = { part: 'afternoon' as const, dayOffset: 0, from: jst(15, 13), to: jst(15, 23) }
    expect(pickApprovalTime(w, () => 0)).toBe(new Date(jst(15, 13)).toISOString())
    const t = Date.parse(pickApprovalTime(w, () => 0.999999))
    expect(t).toBeLessThan(w.to)
    expect(t).toBeGreaterThan(jst(15, 22, 30))
    expect(Date.parse(pickApprovalTime(w, () => 0.5)) % 60_000).toBe(0)
  })
})
