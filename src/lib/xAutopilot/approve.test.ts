import { describe, expect, it } from 'vitest'
import { APPROVE_LEAD_MS, soonestApprovalTime } from './approve'

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
