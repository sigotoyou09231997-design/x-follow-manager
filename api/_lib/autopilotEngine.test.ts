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
  refill,
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

  describe('今日のぶん（時刻が過ぎた枠も、今日の残りに入れる）', () => {
    // 2026-10-10 20:46 JST。1日2回の午前・午後の時刻はとうに過ぎている。
    const EVENING = () => new Date('2026-10-10T11:46:00.000Z')
    const twice = { ...DEFAULT_SETTINGS, postsPerDay: 2, horizonDays: 1 }
    const hm = (iso: string) => {
      const d = new Date(new Date(iso).getTime() + 9 * 3600_000)
      return d.getUTCHours() * 60 + d.getUTCMinutes()
    }

    it('過ぎた枠を捨てず、今日の残り（余裕をおいた後〜23時）に2本とも入れる', async () => {
      const store = ready({ settings: twice })
      const { deps } = makeDeps(store, { now: EVENING })
      const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
      expect(r.created).toBe(2)
      expect(store.posts.map((p) => p.slotKey).sort()).toEqual(['2026-10-10#0', '2026-10-10#1'])
      const [a, b] = store.posts.map((p) => hm(p.at)).sort((x, y) => x - y)
      expect(a).toBeGreaterThanOrEqual(21 * 60 + 1) // 20:46 + 15分の余裕
      expect(b).toBeLessThanOrEqual(23 * 60)
      expect(b - a).toBeGreaterThanOrEqual(30)
    })

    it('今日すでに投稿した枠は、AIに書かせずに飛ばす（書いてから重複と分かると費用だけがかかる）', async () => {
      // 設定を変えて作り直した直後を想定: 作った枠の記録は空だが、午前の枠は投稿済み。
      const store = ready({ settings: twice, slots: [] })
      store.posts.push({ userId: OWNER, at: '2026-10-10T01:30:00.000Z', text: '朝に投稿した分', slotKey: '2026-10-10#0', status: 'posted' })
      const { deps, writePost } = makeDeps(store, { now: EVENING })
      const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
      expect(r.created).toBe(1)
      expect(writePost).toHaveBeenCalledTimes(1)
      expect(store.posts.filter((p) => p.status === 'scheduled').map((p) => p.slotKey)).toEqual(['2026-10-10#1'])
      expect(store.rows.get(OWNER)?.slots).toEqual(expect.arrayContaining(['2026-10-10#0', '2026-10-10#1']))
    })

    it('取り消した予約の枠は、生きている枠に数えない（設定を変えたあとの作り直しで入れ直せる）', async () => {
      const store = ready({ settings: twice, slots: [] })
      store.posts.push({ userId: OWNER, at: '2026-10-10T05:00:00.000Z', text: '取り消した分', slotKey: '2026-10-10#0', status: 'canceled' })
      const { deps } = makeDeps(store, { now: EVENING })
      const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
      expect(r.created).toBe(2)
    })

    it('生きている枠が記録に無いだけなら、AIを呼ばずに記録だけ足す（毎分の調べ直しを繰り返さない）', async () => {
      const store = ready({ settings: twice, slots: [] })
      for (const i of [0, 1]) {
        store.posts.push({ userId: OWNER, at: `2026-10-10T0${i + 1}:00:00.000Z`, text: `投稿済み${i}`, slotKey: `2026-10-10#${i}`, status: 'posted' })
      }
      const { deps, writePost } = makeDeps(store, { now: EVENING })
      const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
      expect(r).toEqual({ created: 0, generated: 0 })
      expect(writePost).not.toHaveBeenCalled()
      expect(store.rows.get(OWNER)?.slots).toEqual(['2026-10-10#0', '2026-10-10#1'])
    })

    it('今日の残りが無い時刻（時間帯の終わり間際）なら、今日のぶんは作らない', async () => {
      const store = ready({ settings: twice })
      const { deps } = makeDeps(store, { now: () => new Date('2026-10-10T13:50:00.000Z') }) // 22:50 JST
      const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
      expect(r.created).toBe(0)
      expect(store.posts).toHaveLength(0)
    })
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

  // 実例: 取り消しても、似た話題・同じ型の文が出続けた。取り消した文が「最近の投稿」から消え、AIに伝わらなかったため。
  describe('本人が取り消した投稿は、次に書くときの「出さないもの」にする', () => {
    it('取り消した文を、AIに渡す（rejected）。取り消す前は渡さない', async () => {
      const store = ready()
      const { deps, writePost } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      const first = store.posts[0]
      expect((writePost.mock.calls[0][0] as unknown as { rejected: string[] }).rejected).toEqual([])

      first.status = 'canceled' // 画面の「取り消す」（削除せず、印を付けて残す）
      first.rejected = true
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      const second = writePost.mock.calls[1][0] as unknown as { rejected: string[] }
      expect(second.rejected).toEqual([first.text])
    })

    it('取り消した文とほぼ同じ文を書いてきたら、検査で弾いて、理由を伝えて書き直させる', async () => {
      const store = ready()
      const { deps, writePost } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      const first = store.posts[0]
      first.status = 'canceled'
      first.rejected = true
      resetWritten() // 次に偽のAIが返すのは、取り消した文と同じ文
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      expect(writePost).toHaveBeenCalledTimes(3) // 最初の1本＋（取り消した文と同じ→書き直し）の2回
      expect(store.posts[1].text).not.toBe(first.text)
      expect(store.posts[1].status).toBe('scheduled')
    })

    // 実例: 今日・明日の枠を「取り消す」と、その日の投稿が無くなり、自動運転を止めて始め直すまで戻らなかった（本人の指摘）。
    // 取り消した枠は空きとして、いちばん近い時刻の枠から、取り消した文を避けて別の文で作り直す。
    it('取り消した枠は、同じ枠の印で、別の文に作り直す（取り消した文は避けるよう AI に渡す）', async () => {
      const store = ready()
      const { deps, writePost } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      const first = store.posts[0]
      first.status = 'canceled'
      first.rejected = true
      const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      expect(r.created).toBe(1)
      const replacement = store.posts.find((p) => p.slotKey === first.slotKey && p.status === 'scheduled')
      expect(replacement).toBeTruthy()
      expect(replacement!.text).not.toBe(first.text)
      expect((writePost.mock.calls[1][0] as unknown as { rejected: string[] }).rejected).toEqual([first.text])
    })

    it('空きが複数あるときは、いちばん近い時刻の枠から作る（まだ作っていない遠い先の枠より先に）', async () => {
      const store = ready()
      const { deps } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
      const [early, late] = [...store.posts].sort((a, b) => a.at.localeCompare(b.at))
      for (const p of store.posts) {
        p.status = 'canceled'
        p.rejected = true
      }
      // 1本ずつ作り直す: 先に近いほう、次に遠いほう
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      const live = () => store.posts.filter((p) => p.status === 'scheduled').map((p) => p.slotKey)
      expect(live()).toEqual([early.slotKey])
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      expect(live()).toEqual([early.slotKey, late.slotKey])
    })

    it('作り直した枠は、もう空きではない（取り消した行が残っていても、作り直しを繰り返さない）', async () => {
      const store = ready()
      const { deps, writePost } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      store.posts[0].status = 'canceled'
      store.posts[0].rejected = true
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 }) // 作り直す
      const calls = writePost.mock.calls.length
      const liveBefore = store.posts.filter((p) => p.status === 'scheduled').length
      // そのあと、ほかの空き（まだ作っていない枠）だけが埋まる。取り消した枠は、作り直した予約が生きているので触らない
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      expect(writePost.mock.calls.length).toBe(calls + 1)
      const key = store.posts[0].slotKey
      expect(store.posts.filter((p) => p.slotKey === key && p.status === 'scheduled')).toHaveLength(1)
      expect(store.posts.filter((p) => p.status === 'scheduled').length).toBe(liveBefore + 1)
    })

    it('手で削除した枠（行ごと消えて印が無い）は、いままでどおり作り直さない', async () => {
      const store = ready()
      const { deps } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      const first = store.posts[0]
      store.posts.splice(0, 1)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      expect(store.posts.some((p) => p.slotKey === first.slotKey)).toBe(false)
    })

    it('「止める」での一括の取り消し（印なし）の枠は、作り直さない', async () => {
      const store = ready()
      const { deps } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
      const keys = store.posts.map((p) => p.slotKey)
      await store.cancelUpcoming(OWNER) // 止めた（記録は残したまま、予約だけ取り消した形）
      await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
      expect(store.posts.filter((p) => keys.includes(p.slotKey) && p.status === 'scheduled')).toHaveLength(0)
    })

    it('作り直しの AI が失敗したら、空きのまま残し、理由を記録する（次の補充でやり直せる）', async () => {
      const store = ready()
      const { deps } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      const first = store.posts[0]
      first.status = 'canceled'
      first.rejected = true
      const failing = makeDeps(store, {
        writePost: (async () => {
          throw new Error('AIが応答しません')
        }) as never,
      })
      const r = await topUp(failing.deps, await store.get(OWNER), { maxGenerations: 1 })
      expect(r.created).toBe(0)
      expect(r.error).toContain('AIが応答しません')
      expect(store.posts.filter((p) => p.slotKey === first.slotKey && p.status === 'scheduled')).toHaveLength(0)
      // 次に成功すれば、同じ空きが埋まる
      const ok = makeDeps(store)
      const again = await topUp(ok.deps, await store.get(OWNER), { maxGenerations: 1 })
      expect(again.created).toBe(1)
      expect(store.posts.some((p) => p.slotKey === first.slotKey && p.status === 'scheduled')).toBe(true)
    })

    it('「自動運転を止める」での一括の取り消しは、本人が嫌がったわけではないので、材料に入れない', async () => {
      const store = ready()
      const { deps } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
      await store.cancelUpcoming(OWNER) // 止めた
      expect(store.posts.every((p) => p.status === 'canceled' && !p.rejected)).toBe(true)
      expect(await store.rejectedTexts(OWNER, 10)).toEqual([])
    })

    it('件数は新しい順に絞る。試し書きにも渡す', async () => {
      const store = ready()
      for (let i = 0; i < 14; i++) {
        store.posts.push({ userId: OWNER, at: `2026-10-0${(i % 9) + 1}T00:00:00.000Z`, text: `取り消した文その${i}`, slotKey: `x${i}`, status: 'canceled', rejected: true })
      }
      const texts = await store.rejectedTexts(OWNER, 10)
      expect(texts).toHaveLength(10)
      expect(texts[0]).toBe('取り消した文その13') // あとから取り消したものが先
      const { deps, writePost } = makeDeps(store)
      await previewPost(deps, OWNER)
      expect((writePost.mock.calls[0][0] as unknown as { rejected: string[] }).rejected).toHaveLength(10)
    })
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
    expect(store.rows.get(OWNER)?.settings.postsPerDay).toBe(5)
    // 古い2本は取り消され、新しい設定の最初の1本だけがその場で作られる（残りは毎分の補充）。
    // 予約の一覧が何分も空のままだと、変えた設定が効いたのか分からない。
    expect(store.posts.filter((p) => p.status === 'canceled')).toHaveLength(2)
    const fresh = store.posts.filter((p) => p.status === 'scheduled')
    expect(fresh).toHaveLength(1)
    expect(store.rows.get(OWNER)?.slots).toHaveLength(1)
  })

  it('「前の投稿を X から消す」は既定でオフ。オンにした時刻を記録し、ほかの設定を保存しても動かさず、オフで消える', async () => {
    const store = ready({ enabled: false })
    const { deps } = makeDeps(store)
    expect(store.rows.get(OWNER)?.settings).toMatchObject({ deletePrevious: false, deletePreviousFrom: null })

    const on = await saveSettings(deps, OWNER, { deletePrevious: true })
    expect(on.settings.deletePrevious).toBe(true)
    const from = on.settings.deletePreviousFrom
    expect(from).toBe(deps.now().toISOString())
    expect(on.rebuilt).toBe(false) // 枠の決まり方ではないので、予約は作り直さない

    // オンのまま別の設定を保存しても、オンにした時刻は変わらない（過去分を巻き込む範囲が広がらない）
    const later = { ...deps, now: () => new Date(deps.now().getTime() + 3600_000) }
    const other = await saveSettings(later, OWNER, { quality: 'saver' })
    expect(other.settings.deletePreviousFrom).toBe(from)

    // 画面（や古い画面）から時刻を送られても、採用しない
    const forged = await saveSettings(later, OWNER, { deletePreviousFrom: '2020-01-01T00:00:00.000Z' } as never)
    expect(forged.settings.deletePreviousFrom).toBe(from)

    const off = await saveSettings(later, OWNER, { deletePrevious: false })
    expect(off.settings).toMatchObject({ deletePrevious: false, deletePreviousFrom: null })
    // もう一度オンにすれば、その時刻からになる
    const again = await saveSettings(later, OWNER, { deletePrevious: true })
    expect(again.settings.deletePreviousFrom).toBe(later.now().toISOString())
  })

  it('作り直しの最初の1本が作れなくても、設定の保存は成功のまま（理由は補充が記録する）', async () => {
    const store = ready()
    const { deps } = makeDeps(store)
    await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    const failing = { ...deps, store: { ...deps.store, insertPost: async () => { throw new Error('保存先が落ちている') } } }
    const r = await saveSettings(failing, OWNER, { postsPerDay: 4 })
    expect(r.rebuilt).toBe(true)
    expect(store.rows.get(OWNER)?.settings.postsPerDay).toBe(4)
  })

  it('動いていないときの設定変更は、予約を作らない（始めるまで費用が出ない）', async () => {
    const store = ready({ enabled: false })
    const { deps } = makeDeps(store)
    const r = await saveSettings(deps, OWNER, { postsPerDay: 5 })
    expect(r.rebuilt).toBe(false)
    expect(store.posts).toHaveLength(0)
  })

  it('範囲外・成り立たない設定は、黙って直さず理由つきで断り、保存済みの設定を変えない', async () => {
    const store = ready({ enabled: false })
    const { deps } = makeDeps(store)
    const before = { ...store.rows.get(OWNER)?.settings }
    const cases: [Partial<AutopilotSettings>, RegExp][] = [
      [{ postsPerDay: 50 }, /1〜8回/],
      [{ monthlyBudgetYen: -1 }, /300〜50,000円/],
      [{ horizonDays: 9 }, /1〜3日/],
      [{ windowStart: '20:00', windowEnd: '08:00' }, /1時間以上あけて/],
      [{ windowStart: '', windowEnd: '23:00' }, /時刻を入力/],
      [{ windowStart: '08:00', windowEnd: '10:00', postsPerDay: 8 }, /1日4回までしか/],
    ]
    for (const [input, message] of cases) {
      await expect(saveSettings(deps, OWNER, input)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(message) })
    }
    expect(store.rows.get(OWNER)?.settings).toEqual(before)
  })

  it('保存済みの設定が成り立つ範囲なら、一部の項目だけの保存でも断らない', async () => {
    const store = ready({ enabled: false })
    const { deps } = makeDeps(store)
    await expect(saveSettings(deps, OWNER, { quality: 'saver' })).resolves.toMatchObject({ settings: { quality: 'saver' } })
  })
})

describe('予約に入れる印', () => {
  it('自動運転の予約の目印（ai_prompt の接頭辞）は、画面と保存先で同じ', () => {
    expect(AUTOPILOT_PREFIX).toBe('autopilot:')
  })
})

// 取り消した直後に画面から頼む「いますぐ作り直し」。毎分の補充を待たず、いちばん近い空きを1つ、別の文で埋める。
describe('いますぐ作り直し（refill）', () => {
  it('取り消した枠のうち、いちばん近い1つを、別の文で作る（1回の呼び出しで AI は1回）', async () => {
    const store = ready()
    const { deps, writePost } = makeDeps(store)
    await topUp(deps, await store.get(OWNER), { maxGenerations: 2 })
    const [early, late] = [...store.posts].sort((a, b) => a.at.localeCompare(b.at))
    early.status = 'canceled'
    early.rejected = true
    late.status = 'canceled'
    late.rejected = true
    const before = writePost.mock.calls.length

    const r = await refill(deps, OWNER)
    expect(r.created).toBe(1)
    expect(writePost.mock.calls.length).toBe(before + 1)
    const live = store.posts.filter((p) => p.status === 'scheduled')
    expect(live.map((p) => p.slotKey)).toEqual([early.slotKey]) // 近いほうだけ。遠いほうは次の呼び出し・毎分の補充で
    expect(live[0].text).not.toBe(early.text)
  })

  it('取り消した枠が無ければ、まだ作っていない枠が1つ埋まるだけ（取り消した枠が無いのに作り直しを重ねない）', async () => {
    const store = ready()
    const { deps } = makeDeps(store)
    const r = await refill(deps, OWNER)
    expect(r.created).toBe(1)
    expect(store.posts).toHaveLength(1)
  })

  it('自動運転が OFF・文体のまとめが無い人には、何もしない（AI を呼ばず、費用が出ない）', async () => {
    const off = memoryStore({ enabled: false, profile: PROFILE, history: history(40) })
    const offDeps = makeDeps(off)
    expect(await refill(offDeps.deps, OWNER)).toEqual({ created: 0, generated: 0 })
    expect(offDeps.writePost).not.toHaveBeenCalled()

    const noProfile = memoryStore({ enabled: true, profile: null, history: history(40) })
    const noProfileDeps = makeDeps(noProfile)
    expect(await refill(noProfileDeps.deps, OWNER)).toEqual({ created: 0, generated: 0 })
    expect(noProfileDeps.writePost).not.toHaveBeenCalled()
  })

  it('月の上限に近いときは、AI を呼ばず、理由を伝えて止まる', async () => {
    const store = ready({ usage: { ...emptyUsage('2026-10'), yen: 100000 } })
    const { deps, writePost } = makeDeps(store)
    const r = await refill(deps, OWNER)
    expect(r.created).toBe(0)
    expect(r.error).toBeTruthy()
    expect(writePost).not.toHaveBeenCalled()
  })
})

// 文を作るたびに最新の履歴を取り入れ、自動運転が出した分は学習から外し、話題の偏りを避けさせる。
// 実例: 自動運転の文が、ハイボール・ジンソーダ・晩酌などお酒の話に偏った。履歴は画面のボタンを押した日のまま古くなり、
// 自動運転が出した文が履歴に戻って次のお手本になり、AI が好む話題が自分で自分を強めていた。
describe('最新の履歴を毎回取り入れる・自動運転の投稿は学習から外す・話題の偏りを避ける', () => {
  const stale = new Date(NOW.getTime() - 5 * 3600_000).toISOString()
  const fresh = new Date(NOW.getTime() - 10 * 60_000).toISOString()
  const ownPost = (id: string, text: string) => ({
    id,
    text,
    created_at: '2026-10-10T00:00:00.000Z',
    public_metrics: { like_count: 3, retweet_count: 0 },
  })
  type Input = { recent: string[]; samples: { id: string }[]; crowded?: string[]; neglected?: string[]; recentStyle?: string }

  describe('履歴の読み直し', () => {
    it('2時間より古い履歴は、文を作る前に読み直す（差分）。新しい投稿が、その回の AI に渡る', async () => {
      const store = ready({ historyFetchedAt: stale })
      const { deps, writePost, fetchOwnPosts } = makeDeps(store)
      fetchOwnPosts.mockResolvedValue([ownPost('9001', '昨夜の最新の独り言です、いまの書き方')])
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      expect(fetchOwnPosts).toHaveBeenCalledTimes(1)
      expect((writePost.mock.calls[0][0] as unknown as Input).recent).toContain('昨夜の最新の独り言です、いまの書き方')
      expect(store.rows.get(OWNER)?.history.some((p) => p.id === '9001')).toBe(true)
    })

    it('2時間以内に読んでいれば、読み直さない（書くたびに X の読み取りを呼ばない）', async () => {
      const store = ready({ historyFetchedAt: fresh })
      const { deps, fetchOwnPosts } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      expect(fetchOwnPosts).not.toHaveBeenCalled()
    })

    it('空きの枠が無ければ、読み直さない（文を作らない回に X の読み取りを使わない）', async () => {
      const store = ready({ historyFetchedAt: stale })
      const { deps, fetchOwnPosts } = makeDeps(store)
      for (let i = 0; i < 20; i++) await topUp(deps, await store.get(OWNER), { maxGenerations: 4 })
      fetchOwnPosts.mockClear()
      await topUp(deps, await store.get(OWNER), { maxGenerations: 4 }) // 全部埋まったあと
      expect(fetchOwnPosts).not.toHaveBeenCalled()
    })

    it('読めなかったときは、いまある履歴でそのまま書く（読めないことで予約が止まらない・エラーにもしない）', async () => {
      const store = ready({ historyFetchedAt: stale })
      const { deps, fetchOwnPosts } = makeDeps(store)
      fetchOwnPosts.mockRejectedValue(new Error('Xが応答しません'))
      const r = await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      expect(r.created).toBe(1)
      expect(r.error).toBeUndefined()
      expect(store.rows.get(OWNER)?.lastError).toBeNull()
    })

    it('試し書きも、古ければ読み直してから書く', async () => {
      const store = ready({ historyFetchedAt: stale })
      const { deps, fetchOwnPosts } = makeDeps(store)
      await previewPost(deps, OWNER)
      expect(fetchOwnPosts).toHaveBeenCalledTimes(1)
    })
  })

  describe('自動運転が投稿した分を、学習から外す', () => {
    const hist = history(40)
    const autopilotIds = hist.slice(0, 6).map((p) => p.id) // 新しい6件は、実は自動運転が出した文

    function withAutopilotPosted() {
      const store = ready({ history: hist, historyFetchedAt: fresh })
      store.posts.push({
        userId: OWNER,
        at: '2026-09-02T00:00:00.000Z',
        text: '自動運転が出した文です',
        slotKey: '2026-09-02#0',
        status: 'posted',
        postedTweetIds: autopilotIds,
      })
      return store
    }

    it('お手本・最近の投稿に、自動運転が投稿した X の投稿を入れない。自動運転の文そのものは「最近の投稿」に入る（同じ話題を避けるため）', async () => {
      const store = withAutopilotPosted()
      const { deps, writePost } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      const input = writePost.mock.calls[0][0] as unknown as Input
      expect(input.samples.some((p) => autopilotIds.includes(p.id))).toBe(false)
      for (const p of hist.slice(0, 6)) expect(input.recent).not.toContain(p.text)
      expect(input.recent).toContain('自動運転が出した文です')
    })

    it('文体のまとめにも、自動運転が投稿した分は渡さない', async () => {
      const store = withAutopilotPosted()
      const { deps, writeProfile } = makeDeps(store)
      await buildProfile(deps, OWNER)
      const passed = (writeProfile.mock.calls[0][0] as unknown as { history: { id: string }[] }).history
      expect(passed).toHaveLength(34)
      expect(passed.some((p) => autopilotIds.includes(p.id))).toBe(false)
    })

    it('自動運転の投稿が無ければ、履歴はそのまま', async () => {
      const store = ready({ history: hist, historyFetchedAt: fresh })
      const { deps, writeProfile } = makeDeps(store)
      await buildProfile(deps, OWNER)
      expect((writeProfile.mock.calls[0][0] as unknown as { history: unknown[] }).history).toHaveLength(40)
    })
  })

  describe('話題の偏り', () => {
    // 新しい順に: 最近の15件は当たり障りのない独り言 → 会社 → ゲーム（本人がふだん書く話題）
    const at = (i: number) => new Date(Date.UTC(2026, 9, 9) - i * 3600_000).toISOString()
    const humanPosts = [
      ...Array.from({ length: 15 }, (_, i) => `何もない一日だったと思う、その${i}`),
      ...Array.from({ length: 15 }, (_, i) => `今日の会社は忙しかった、その${i}`),
      ...Array.from({ length: 10 }, (_, i) => `パズドラのダンジョンを回した、その${i}`),
    ].map((text, i) => ({ id: String(2000 + i), text, at: at(i), likes: 0, reposts: 0 }))

    function withRecentAutopilot(texts: string[]) {
      const store = ready({ history: humanPosts, historyFetchedAt: fresh })
      texts.forEach((text, i) =>
        store.posts.push({ userId: OWNER, at: new Date(Date.UTC(2026, 9, 9, 12) - i * 3600_000).toISOString(), text, slotKey: `2026-10-0${(i % 9) + 1}#${i}`, status: 'posted' })
      )
      return store
    }

    it('自動運転が最近出した文が、お酒の話に偏っていたら、「最近多すぎる話題」として渡し、ふだん書くのに最近少ない話題を勧める', async () => {
      const store = withRecentAutopilot([
        '最近、ジンソーダの炭酸が強いほうが好きやと気づいた。',
        '帰り道のハイボールが一番うまい。',
        '晩酌の楽しみが増えたわ。',
        '昼に食べたおにぎり、具が最後まで来なかった。',
        '電車で席が空いてるのに立ってる人がいた。',
      ])
      const { deps, writePost } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      const input = writePost.mock.calls[0][0] as unknown as Input
      expect(input.crowded?.[0]).toContain('お酒・晩酌')
      expect(input.crowded?.[0]).toContain('ハイボール')
      // 本人がふだん書く（会社・ゲーム）のに、最近の30件には出ていない
      expect(input.neglected).toEqual(expect.arrayContaining(['会社・仕事', 'ゲーム']))
      expect(input.neglected).not.toContain('お酒・晩酌')
    })

    it('偏っていなければ、「多すぎる」は出さない', async () => {
      const store = withRecentAutopilot([
        'ジンソーダを飲んでみた。',
        '昼に食べたおにぎり、具が最後まで来なかった。',
        '電車で席が空いてるのに立ってる人がいた。',
        '税金が高すぎる。',
        '週末は何もしないで寝ていたい。',
      ])
      const { deps, writePost } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      expect((writePost.mock.calls[0][0] as unknown as Input).crowded).toEqual([])
    })

    it('同じ回で続けて作るとき、いま作った文も数える（1回の実行で偏らせない）', async () => {
      const store = ready({
        history: humanPosts,
        historyFetchedAt: fresh,
        settings: { ...DEFAULT_SETTINGS, postsPerDay: 6, horizonDays: 2 },
      })
      // 偽の AI が、お酒の話ばかり書く。渡された指示を全部覚えておく
      const seen: Input[] = []
      const drinks = ['ハイボールが好きすぎて困る', 'ジンソーダの新作を試した', '晩酌の時間が一日の楽しみ', 'ウイスキーの香りが落ち着く']
      let n = 0
      const { deps } = makeDeps(store, {
        writePost: (async (input: Input & { onUsage?: (u: { inputTokens: number; outputTokens: number }) => void }) => {
          seen.push(input)
          input.onUsage?.({ inputTokens: 10, outputTokens: 10 })
          return drinks[n++ % 4]
        }) as never,
      })
      await topUp(deps, await store.get(OWNER), { maxGenerations: 4 })
      expect(seen.length).toBe(4)
      expect(seen[0].crowded).toEqual([]) // 最初は、まだ偏っていない
      // 4本目を書くころには、直前の3本（すべてお酒）が「多すぎる」として渡っている
      expect(seen[3].crowded?.[0]).toContain('お酒・晩酌（直近3件のうち3件')
    })

    it('傾向の数字（最新の履歴から計算）を毎回渡す。履歴が少なすぎれば渡さない', async () => {
      const store = withRecentAutopilot([])
      const { deps, writePost } = makeDeps(store)
      await topUp(deps, await store.get(OWNER), { maxGenerations: 1 })
      expect((writePost.mock.calls[0][0] as unknown as Input).recentStyle).toContain('直近40件')

      const few = ready({ history: humanPosts.slice(0, 5), historyFetchedAt: fresh })
      const fewDeps = makeDeps(few)
      await topUp(fewDeps.deps, await few.get(OWNER), { maxGenerations: 1 })
      expect((fewDeps.writePost.mock.calls[0][0] as unknown as Input).recentStyle).toBeUndefined()
    })
  })
})
