// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ALIVE_WITHIN_MINUTES } from '../../src/lib/autopost/draft'
import type { ChannelName, PosterStatus } from './autopostDoc.js'
import {
  buildSilentPayload,
  GIVE_UP_AFTER_MINUTES,
  pickSilent,
  SILENT_AFTER_MINUTES,
  watchPosters,
  type PosterWatchDeps,
  type WatchedChannel,
} from './posterWatch.js'

const NOW = Date.parse('2026-10-12T06:00:00.000Z')
const minutesBefore = (m: number) => new Date(NOW - m * 60000).toISOString()

function row(
  channel: ChannelName,
  reportedMinutesAgo: number,
  extra: { userId?: string; paused?: boolean; status?: Partial<PosterStatus> } = {}
): WatchedChannel {
  return {
    userId: extra.userId ?? 'u1',
    channel,
    paused: extra.paused ?? false,
    status: { lastPost: null, today: 0, at: minutesBefore(reportedMinutesAgo), ...extra.status },
  }
}

/** 通知の送り先と「通知済み」の印を覚えておくだけの入れ物。 */
function fakeDeps(rows: WatchedChannel[], devices: Record<string, number> = { u1: 1 }) {
  const sent: { userId: string; payload: string }[] = []
  const marked: { userId: string; channel: ChannelName; alertedAt: string }[] = []
  const deps: PosterWatchDeps = {
    listChannels: async () => rows,
    notify: async (userId, payload) => {
      const n = devices[userId] ?? 0
      if (n > 0) sent.push({ userId, payload })
      return n
    },
    markAlerted: async (userId, channel, _seen, alertedAt) => {
      marked.push({ userId, channel, alertedAt })
    },
  }
  return { deps, sent, marked }
}

describe('止まりの判定（pickSilent）', () => {
  it('画面の「応答がありません」と同じ分数で止まりと見なす', () => {
    expect(SILENT_AFTER_MINUTES).toBe(ALIVE_WITHIN_MINUTES)
  })

  it('報告が新しいうちは通知しない', () => {
    expect(pickSilent([row('yay', 5), row('discord', SILENT_AFTER_MINUTES - 1)], NOW)).toEqual([])
  })

  it('報告が途絶えて基準を超えたら止まりと見なす', () => {
    expect(pickSilent([row('yay', SILENT_AFTER_MINUTES)], NOW)).toHaveLength(1)
    expect(pickSilent([row('yay', 180)], NOW)).toHaveLength(1)
  })

  it('一度も報告が無い投稿先（status なし）は対象外', () => {
    expect(pickSilent([{ userId: 'u1', channel: 'yay', status: null, paused: false }], NOW)).toEqual([])
  })

  it('画面で止めているあいだは、報告が無くても通知しない（表の印・投稿役の報告のどちらでも）', () => {
    expect(pickSilent([row('yay', 90, { paused: true })], NOW)).toEqual([])
    expect(pickSilent([row('yay', 90, { status: { paused: true } })], NOW)).toEqual([])
  })

  it('通知済みの止まりは、もう通知しない', () => {
    expect(pickSilent([row('yay', 90, { status: { alertedAt: minutesBefore(60) } })], NOW)).toEqual([])
  })

  it('3日より前の報告は「もう使っていない」と見なして通知しない', () => {
    expect(pickSilent([row('yay', GIVE_UP_AFTER_MINUTES + 1)], NOW)).toEqual([])
    expect(pickSilent([row('yay', GIVE_UP_AFTER_MINUTES - 1)], NOW)).toHaveLength(1)
  })

  it('報告の時刻が読めない status は通知しない（壊れた値で毎分鳴らさない）', () => {
    expect(pickSilent([row('yay', 90, { status: { at: 'ばらばら' } })], NOW)).toEqual([])
  })
})

describe('通知の文面', () => {
  it('止まった投稿先と、何分前から途絶えたかが入る', () => {
    const payload = JSON.parse(buildSilentPayload([row('yay', 35), row('discord', 125)], NOW))
    expect(payload.title).toBe('自動投稿が止まっているかもしれません')
    expect(payload.body).toContain('Yay：35分前から報告がありません')
    expect(payload.body).toContain('ディスコード：2時間5分前から報告がありません')
    expect(payload.tag).toBe('poster-silent')
    expect(payload.url).toBe('/')
  })
})

describe('見張り（watchPosters）', () => {
  it('動いていれば何も送らない', async () => {
    const { deps, sent, marked } = fakeDeps([row('yay', 3), row('discord', 4)])
    expect(await watchPosters(deps, NOW)).toEqual({ silent: 0, notified: 0 })
    expect(sent).toEqual([])
    expect(marked).toEqual([])
  })

  it('止まっていれば通知し、通知済みの印を付ける。次の分には、もう送らない', async () => {
    const rows = [row('yay', 30)]
    const { deps, sent, marked } = fakeDeps(rows)
    expect(await watchPosters(deps, NOW)).toEqual({ silent: 1, notified: 1 })
    expect(sent).toHaveLength(1)
    expect(marked).toEqual([{ userId: 'u1', channel: 'yay', alertedAt: new Date(NOW).toISOString() }])

    // 印が付いた状態を、次の毎分実行が読んだものとして
    rows[0] = row('yay', 31, { status: { alertedAt: marked[0].alertedAt } })
    expect(await watchPosters(deps, NOW + 60000)).toEqual({ silent: 0, notified: 0 })
    expect(sent).toHaveLength(1)
  })

  it('同じ人の2つの投稿先が止まっていれば、通知は1通にまとめる', async () => {
    const { deps, sent, marked } = fakeDeps([row('yay', 30), row('discord', 40)])
    await watchPosters(deps, NOW)
    expect(sent).toHaveLength(1)
    expect(sent[0].payload).toContain('Yay')
    expect(sent[0].payload).toContain('ディスコード')
    expect(marked.map((m) => m.channel).sort()).toEqual(['discord', 'yay'])
  })

  it('人ごとに別々に通知する', async () => {
    const { deps, sent } = fakeDeps([row('yay', 30, { userId: 'u1' }), row('yay', 30, { userId: 'u2' })], { u1: 1, u2: 2 })
    expect(await watchPosters(deps, NOW)).toEqual({ silent: 2, notified: 3 })
    expect(sent.map((s) => s.userId).sort()).toEqual(['u1', 'u2'])
  })

  it('届け先が無いとき（通知を有効にしていない）は、通知済みにせず、次の分にもう一度試す', async () => {
    const { deps, marked } = fakeDeps([row('yay', 30)], {})
    expect(await watchPosters(deps, NOW)).toEqual({ silent: 1, notified: 0 })
    expect(marked).toEqual([])
  })

  it('1人への送信が失敗しても、ほかの人への通知は止めない', async () => {
    const rows = [row('yay', 30, { userId: 'u1' }), row('yay', 30, { userId: 'u2' })]
    const sent: string[] = []
    const deps: PosterWatchDeps = {
      listChannels: async () => rows,
      notify: async (userId) => {
        if (userId === 'u1') throw new Error('送れない')
        sent.push(userId)
        return 1
      },
      markAlerted: async () => {},
    }
    expect(await watchPosters(deps, NOW)).toEqual({ silent: 2, notified: 1 })
    expect(sent).toEqual(['u2'])
  })
})
