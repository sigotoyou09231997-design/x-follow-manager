import { describe, expect, it } from 'vitest'
import { APPROVE_LEAD_MS, MIN_POST_GAP_MS, lastPostedAt, pullForwardTime, soonestApprovalTime } from './approve'

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

describe('毎分の前倒し（先に出した予約のあと、残りが待たされない）', () => {
  it('先の投稿可能な予約が出て、残りが1時間以上先なら、直前の投稿から最低間隔あとへ前倒しする', () => {
    // 25分前に出した → 次は5分後が下限。いま出ようとしているのは、1時間後のもの
    const list = [post('p', 'posted', -25), post('b', 'scheduled', 60), post('c', 'scheduled', 200)]
    expect(pullForwardTime(list, NOW)).toEqual({ id: 'b', scheduledAt: new Date(NOW - 25 * 60_000 + MIN_POST_GAP_MS).toISOString() })
  })

  it('直前の投稿が十分前なら、1分後へ前倒しする（長く待たせない）', () => {
    const list = [post('p', 'posted', -300), post('b', 'scheduled', 60)]
    expect(pullForwardTime(list, NOW)).toEqual({ id: 'b', scheduledAt: new Date(NOW + 60_000).toISOString() })
  })

  it('動かすのは、いちばん早い投稿可能な予約だけ。確認待ち・取り消しは数えない', () => {
    const list = [post('d', 'draft', 5), post('x', 'canceled', 10), post('b', 'scheduled', 90), post('c', 'scheduled', 30)]
    expect(pullForwardTime(list, NOW)?.id).toBe('c')
  })

  it('すでに出せる時刻に近い（数分の差）なら、動かさない。投稿可能な予約が無ければ何もしない', () => {
    expect(pullForwardTime([post('b', 'scheduled', 2)], NOW)).toBeUndefined()
    expect(pullForwardTime([post('d', 'draft', 90)], NOW)).toBeUndefined()
    expect(pullForwardTime([], NOW)).toBeUndefined()
  })

  it('動かしたあと、もう一度やっても、同じ時刻のまま（毎分書き換え続けない）', () => {
    const list = [post('p', 'posted', -25), post('b', 'scheduled', 60)]
    const moved = pullForwardTime(list, NOW)!
    const after = [post('p', 'posted', -25), { id: 'b', status: 'scheduled', scheduledAt: moved.scheduledAt }]
    expect(pullForwardTime(after, NOW + 60_000)).toBeUndefined()
  })
})

describe('本人が時刻を決めた予約は、動かさない', () => {
  const fixed = (id: string, status: string, min: number) => ({ ...post(id, status, min), fixedTime: true })

  it('投稿可能にしても、前倒ししない', () => {
    expect(soonestApprovalTime(fixed('b', 'draft', 300), [], NOW)).toBeUndefined()
  })

  it('毎分の前倒しの対象にしない。時刻を決めていない、次に早い予約が前倒しされる', () => {
    const list = [post('p', 'posted', -300), fixed('f', 'scheduled', 90), post('c', 'scheduled', 200)]
    expect(pullForwardTime(list, NOW)?.id).toBe('c')
    expect(pullForwardTime([post('p', 'posted', -300), fixed('f', 'scheduled', 90)], NOW)).toBeUndefined()
  })
})
