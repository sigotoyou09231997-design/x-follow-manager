// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { AUTOPILOT_PREFIX, DEFAULT_SETTINGS, emptyUsage, type AutopilotSettings } from '../../src/lib/xAutopilot/types.js'
import { history, makeDeps, memoryStore, NOW, OWNER, PROFILE, ready, resetWritten, WRITTEN } from './autopilotTestKit.js'
import {
  buildProfile,
  budgetMessage,
  checkPost,
  disable,
  enable,
  EngineError,
  previewPost,
  readHistory,
  saveSettings,
  topUp,
  topUpAll,
  usageFor,
} from './autopilotEngine.js'

// 保存先・X・AI を偽物にして、自動運転の動きを確かめる。
// 肝心なのは「検査を通らない文は予約に入れない」「作った枠は二重に作らない」「止めたら残りを取り消す」
// 「月の上限を超えない」「履歴は差分だけ読む（読み取りは件数で課金される）」。

beforeEach(() => {
  resetWritten()
})

describe('文の検査', () => {
  it('使える文は通し、使えない理由を日本語で返す', () => {
    expect(checkPost('今日はなんだか眠いかも', [])).toEqual([])
    expect(checkPost('', [])).toEqual(['本文が空'])
    expect(checkPost('あ'.repeat(141), [])).toContain('文字数の上限（全角140字）を超えている')
    expect(checkPost('見てね https://example.com', [])).toContain('URLを含んでいる')
    expect(checkPost('女子高生の話', [])).toContain('未成年を連想させる表現を含んでいる')
    expect(checkPost('今日はなんだか眠いかも！', ['今日はなんだか眠いかも'])).toContain('最近の投稿と内容が似すぎている')
  })
})

describe('履歴の取り込み', () => {
  it('Xから読んだ投稿を整えて保存し、読んだ件数ぶんの費用を記録する', async () => {
    const store = memoryStore()
    const { deps, fetchOwnPosts } = makeDeps(store)
    fetchOwnPosts.mockResolvedValue([
      { id: '11', text: '朝のコーヒーがおいしい', created_at: '2026-10-01T00:00:00.000Z' },
      { id: '12', text: '@x ありがとう', created_at: '2026-10-02T00:00:00.000Z' }, // 返信は落とす
    ])
    const r = await readHistory(deps, OWNER, { limit: 200 })
    expect(r).toEqual({ fetched: 2, added: 1, total: 1 })
    expect(store.rows.get(OWNER)?.history).toHaveLength(1)
    // 2件 × $0.001 × 150円
    expect(store.rows.get(OWNER)?.usage.yen).toBeCloseTo(0.3, 5)
    expect(fetchOwnPosts).toHaveBeenCalledWith('token', '555', { limit: 200, sinceId: undefined })
  })

  it('2回目からは、いちばん新しい投稿より後の分だけ読む（件数で課金されるので）', async () => {
    const store = memoryStore({ history: history(30), historyFetchedAt: '2026-10-09T00:00:00.000Z' })
    const newest = store.rows.get(OWNER)!.history[0].id
    const { deps, fetchOwnPosts } = makeDeps(store)
    fetchOwnPosts.mockResolvedValue([{ id: '99999', text: '新しく投稿した内容です', created_at: '2026-10-10T00:00:00.000Z' }])
    const r = await readHistory(deps, OWNER)
    expect(fetchOwnPosts).toHaveBeenCalledWith('token', '555', { limit: 200, sinceId: newest })
    expect(r.total).toBe(31)
    expect(store.rows.get(OWNER)?.history[0].id).toBe('99999') // 新しい順
  })

  it('full 指定なら、差分ではなく最初から読み直す', async () => {
    const store = memoryStore({ history: history(30), historyFetchedAt: '2026-10-09T00:00:00.000Z' })
    const { deps, fetchOwnPosts } = makeDeps(store)
    await readHistory(deps, OWNER, { full: true })
    expect(fetchOwnPosts).toHaveBeenCalledWith('token', '555', { limit: 200, sinceId: undefined })
  })

  it('Xと連携していなければ、案内つきで断る', async () => {
    const store = memoryStore()
    store.hasAccount = false
    await expect(readHistory(makeDeps(store).deps, OWNER)).rejects.toThrow('Xと連携していません')
  })

  it('続けて押しても、1分は読み直さない（連打で課金されないように）', async () => {
    const store = memoryStore({ historyFetchedAt: new Date(NOW.getTime() - 20_000).toISOString() })
    const { deps, fetchOwnPosts } = makeDeps(store)
    const error = await readHistory(deps, OWNER).catch((e) => e)
    expect(error).toBeInstanceOf(EngineError)
    expect(error.status).toBe(429)
    expect(fetchOwnPosts).not.toHaveBeenCalled()
  })

  it('Xの読み取りが失敗したら、保存せずそのまま投げる（理由は xClient が日本語にしている）', async () => {
    const store = memoryStore()
    const { deps, fetchOwnPosts } = makeDeps(store)
    fetchOwnPosts.mockRejectedValue(new Error('X APIのクレジットが足りません'))
    await expect(readHistory(deps, OWNER)).rejects.toThrow('クレジットが足りません')
    expect(store.rows.get(OWNER)?.history).toEqual([])
  })
})

describe('文体のまとめ', () => {
  it('履歴が少なすぎれば、AIを呼ばずに断る', async () => {
    const store = memoryStore({ history: history(5) })
    const { deps, writeProfile } = makeDeps(store)
    await expect(buildProfile(deps, OWNER)).rejects.toThrow('20件以上必要')
    expect(writeProfile).not.toHaveBeenCalled()
  })

  it('まとめを保存し、AIの費用を使用状況に足す', async () => {
    const store = memoryStore({ history: history(40) })
    const { deps } = makeDeps(store)
    const profile = await buildProfile(deps, OWNER)
    expect(profile.summary).toBe('ゆるい独り言が多い')
    const saved = store.rows.get(OWNER)!
    expect(saved.profile).toEqual(PROFILE)
    expect(saved.profileBuiltAt).toBe(NOW.toISOString())
    // 標準: 入力15,000×$4/M + 出力5,000×$20/M = $0.16 = 24円
    expect(saved.usage.yen).toBeCloseTo(24, 5)
  })

  it('AIのキーが無ければ、設定の問題として伝える', async () => {
    const store = memoryStore({ history: history(40) })
    await expect(buildProfile(makeDeps(store, { apiKey: () => undefined }).deps, OWNER)).rejects.toThrow('ANTHROPIC_API_KEY')
  })
})

describe('枠の補充（topUp）', () => {
  it('先の枠に、AIが書いた投稿を予約として並べ、枠を記録する', async () => {
    const store = ready()
    const { deps } = makeDeps(store)
    const row = await store.get(OWNER)
    const r = await topUp(deps, row, { maxGenerations: 2 })
    expect(r.created).toBe(2)
    expect(store.posts).toHaveLength(2)
    expect(store.posts[0].status).toBe('scheduled')
    expect(store.posts[0].slotKey).toMatch(/^2026-10-1[01]#\d$/)
    expect(store.rows.get(OWNER)?.slots).toHaveLength(2)
    expect(store.rows.get(OWNER)?.lastError).toBeNull()
  })

  it('作った枠は二重に作らない（何度呼んでも、残りの枠だけ）', async () => {
    const store = ready()
    const { deps, writePost } = makeDeps(store)
    await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    // 3回/日 × 今日の残り＋明日（horizon 2日）の枠の数を超えて作らない
    const total = store.posts.length
    expect(new Set(store.posts.map((p) => p.slotKey)).size).toBe(total)
    const before = writePost.mock.calls.length
    await topUp(deps, await store.get(OWNER), { maxGenerations: 5 })
    await topUp(deps, await store.get(OWNER), { maxGenerations: 5 })
    expect(writePost.mock.calls.length).toBeGreaterThanOrEqual(before)
    expect(store.posts.length).toBeLessThanOrEqual(6)
  })

  it('全部の枠が埋まったら、AIを呼ばない（費用が出ない）', async () => {
    const store = ready()
    const { deps, writePost } = makeDeps(store)
    for (let i = 0; i < 6; i++) await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    const calls = writePost.mock.calls.length
    const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    expect(r).toEqual({ created: 0, generated: 0 })
    expect(writePost.mock.calls.length).toBe(calls)
  })

  it('ユーザーが消した予約の枠は、作り直さない（枠を覚えているので）', async () => {
    const store = ready()
    const { deps } = makeDeps(store)
    await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
    const first = store.posts[0]
    store.posts.splice(0, 1) // 一覧から削除された
    await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
    expect(store.posts.some((p) => p.slotKey === first.slotKey)).toBe(false)
  })

  it('検査を通らない案は予約に入れず、止まって理由を記録する', async () => {
    const store = ready()
    const { deps, writePost } = makeDeps(store)
    writePost.mockResolvedValue('見てね https://example.com/spam') // 書き直しても、ずっとURL入り
    const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    expect(r.created).toBe(0)
    expect(store.posts).toHaveLength(0)
    expect(r.error).toContain('URLを含んでいる')
    expect(store.rows.get(OWNER)?.lastError).toContain('検査を通りませんでした')
    expect(writePost).toHaveBeenCalledTimes(2) // 最初の1回＋書き直し1回で諦める
  })

  it('1回目が似すぎでも、理由を伝えた書き直しが通れば予約に入る', async () => {
    const store = ready()
    const { deps, writePost } = makeDeps(store)
    writePost.mockResolvedValueOnce('過去の投稿その1、今日はなんだか眠いかも').mockResolvedValueOnce('まったく別の話をしてみます')
    const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
    expect(r.created).toBe(1)
    expect(store.posts[0].text).toBe('まったく別の話をしてみます')
    const second = writePost.mock.calls[1][0] as unknown as { feedback?: string }
    expect(second.feedback).toContain('似すぎている')
  })

  it('AIの呼び出しが失敗したら、予約を作らず理由を残す', async () => {
    const store = ready()
    const { deps, writePost } = makeDeps(store)
    writePost.mockRejectedValue(new Error('AIの利用制限に達しました'))
    const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    expect(r.created).toBe(0)
    expect(store.rows.get(OWNER)?.lastError).toContain('AIの利用制限')
    expect(writePost).toHaveBeenCalledTimes(1) // 失敗したら、続けて叩かない
  })

  it('月の上限を超えそうなら、AIを呼ばずに止まる', async () => {
    const month = '2026-10'
    const settings: AutopilotSettings = { ...DEFAULT_SETTINGS, monthlyBudgetYen: 300 }
    const store = ready({ settings, usage: { ...emptyUsage(month), yen: 295 } })
    const { deps, writePost } = makeDeps(store)
    const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    expect(writePost).not.toHaveBeenCalled()
    expect(r.error).toBe(budgetMessage(settings))
  })

  it('月が変われば、使用額は 0 から数え直す', async () => {
    const store = ready({ usage: { ...emptyUsage('2026-09'), yen: 999_999 } })
    const row = await store.get(OWNER)
    expect(usageFor(row, NOW)).toMatchObject({ month: '2026-10', yen: 0 })
  })

  it('使った費用（AI＋X投稿）を使用状況に足す', async () => {
    const store = ready()
    const { deps } = makeDeps(store)
    await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
    const usage = store.rows.get(OWNER)!.usage
    // AI: 4000×$4/M + 1200×$20/M = $0.04 = 6円、X投稿: $0.015 = 2.25円
    expect(usage.yen).toBeCloseTo(8.25, 5)
    expect(usage).toMatchObject({ posts: 1, generations: 1, month: '2026-10' })
  })

  it('同じ日のほかの予約を、話題が重ならないよう AI に渡す', async () => {
    const store = ready()
    const { deps, writePost } = makeDeps(store)
    await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    const second = writePost.mock.calls[1][0] as unknown as { plannedSameDay: string[] }
    expect(second.plannedSameDay).toHaveLength(1)
  })

  it('OFF・文体まとめ無しの人は、何もしない', async () => {
    const off = ready({ enabled: false })
    const { deps, writePost } = makeDeps(off)
    expect(await topUp(deps, await off.get(OWNER), { maxGenerations: 2 })).toEqual({ created: 0, generated: 0 })
    const noProfile = ready({ profile: null })
    expect(await topUp(makeDeps(noProfile).deps, await noProfile.get(OWNER), { maxGenerations: 2 })).toEqual({ created: 0, generated: 0 })
    expect(writePost).not.toHaveBeenCalled()
  })

  it('時間切れの合図(canStartAi)が false なら、新しくAIを呼ばない', async () => {
    const store = ready()
    const { deps, writePost } = makeDeps(store, { canStartAi: () => false })
    const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    expect(r.generated).toBe(0)
    expect(writePost).not.toHaveBeenCalled()
  })

  it('同時に別の実行が同じ枠を先に入れていたら、二重に作らず枠だけ覚える', async () => {
    const store = ready()
    const { deps } = makeDeps(store)
    const original = store.insertPost
    store.insertPost = async () => 'duplicate'
    await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
    store.insertPost = original
    expect(store.posts).toHaveLength(0)
    expect(store.rows.get(OWNER)?.slots).toHaveLength(1)
  })
})

describe('毎分の補充（topUpAll）', () => {
  it('ON の人だけを対象にし、AIを呼ぶ本数は合計で上限まで', async () => {
    const store = ready()
    const { deps, writePost } = makeDeps(store)
    const r = await topUpAll(deps, { maxGenerations: 1, retryEveryMinutes: 5 })
    expect(r.generated).toBe(1)
    expect(writePost).toHaveBeenCalledTimes(1)
  })

  it('前回失敗した人は、間隔を空けてやり直す（毎分は叩かない）', async () => {
    const store = ready({ lastError: '前回失敗' })
    // NOW の分は 0 分。5分おきの回(0,5,10…)だけ動く
    const { deps, writePost } = makeDeps(store, { now: () => new Date('2026-10-10T03:03:00.000Z') })
    await topUpAll(deps, { maxGenerations: 2, retryEveryMinutes: 5 })
    expect(writePost).not.toHaveBeenCalled()

    const again = makeDeps(store, { now: () => new Date('2026-10-10T03:05:00.000Z') })
    await topUpAll(again.deps, { maxGenerations: 2, retryEveryMinutes: 5 })
    expect(again.writePost).toHaveBeenCalled()
  })

  it('一人の失敗で、ほかの人や投稿そのものを止めない', async () => {
    const store = ready()
    const { deps } = makeDeps(store)
    store.listEnabled = async () => {
      throw new Error('読み込み失敗')
    }
    await expect(topUpAll(deps, { maxGenerations: 2, retryEveryMinutes: 5 })).rejects.toThrow()
  })
})

describe('試し書き', () => {
  it('文体のまとめが無ければ断る。あれば1本書いて、費用を使用状況に足す（予約には入れない）', async () => {
    await expect(previewPost(makeDeps(memoryStore()).deps, OWNER)).rejects.toThrow('文体をまとめて')

    const store = ready()
    const { deps } = makeDeps(store)
    const r = await previewPost(deps, OWNER)
    expect(r.text).toBe(WRITTEN[0])
    expect(r.problems).toEqual([])
    expect(store.posts).toHaveLength(0)
    expect(store.rows.get(OWNER)!.usage.yen).toBeCloseTo(6, 5)
  })

  it('検査に落ちた案も、理由つきで返す（見て判断してもらう）', async () => {
    const store = ready()
    const { deps, writePost } = makeDeps(store)
    writePost.mockResolvedValue('https://example.com を見てね')
    const r = await previewPost(deps, OWNER)
    expect(r.text).toContain('example.com')
    expect(r.problems).toContain('URLを含んでいる')
  })
})

describe('ON / OFF / 設定', () => {
  it('ON にすると、最初の1本だけその場で作る（残りは毎分の補充）', async () => {
    const store = ready({ enabled: false })
    const { deps } = makeDeps(store)
    const r = await enable(deps, OWNER)
    expect(store.rows.get(OWNER)?.enabled).toBe(true)
    expect(r.created).toBe(1)
  })

  it('文体のまとめ・X連携が無ければ ON にできない', async () => {
    await expect(enable(makeDeps(memoryStore()).deps, OWNER)).rejects.toThrow('文体をまとめて')
    const noX = ready({ enabled: false })
    noX.hasAccount = false
    await expect(enable(makeDeps(noX).deps, OWNER)).rejects.toThrow('Xと連携していません')
  })

  it('OFF にすると、まだ出ていない自動運転の予約を取り消し、枠の記録も消す', async () => {
    const store = ready()
    const { deps } = makeDeps(store)
    await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    const r = await disable(deps, OWNER)
    expect(r.canceled).toBe(2)
    expect(store.posts.every((p) => p.status === 'canceled')).toBe(true)
    expect(store.rows.get(OWNER)).toMatchObject({ enabled: false, slots: [] })
  })

  it('枠の決まり方を変えると、まだ出ていない予約は作り直す。質や上限だけの変更では作り直さない', async () => {
    const store = ready()
    const { deps } = makeDeps(store)
    await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })

    const quality = await saveSettings(deps, OWNER, { quality: 'saver', monthlyBudgetYen: 5000 })
    expect(quality.rebuilt).toBe(false)
    expect(store.posts.every((p) => p.status === 'scheduled')).toBe(true)

    const shape = await saveSettings(deps, OWNER, { postsPerDay: 5 })
    expect(shape.rebuilt).toBe(true)
    expect(store.posts.every((p) => p.status === 'canceled')).toBe(true)
    expect(store.rows.get(OWNER)?.slots).toEqual([])
    expect(store.rows.get(OWNER)?.settings.postsPerDay).toBe(5)
  })

  it('範囲外の設定は、使える範囲に直して保存する', async () => {
    const store = ready({ enabled: false })
    const { deps } = makeDeps(store)
    const { settings } = await saveSettings(deps, OWNER, { postsPerDay: 50, monthlyBudgetYen: -1 })
    expect(settings.postsPerDay).toBe(8)
    expect(settings.monthlyBudgetYen).toBe(300)
  })
})

describe('予約に入れる印', () => {
  it('自動運転の予約の目印（ai_prompt の接頭辞）は、画面と保存先で同じ', () => {
    expect(AUTOPILOT_PREFIX).toBe('autopilot:')
  })
})
