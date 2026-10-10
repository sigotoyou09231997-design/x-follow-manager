// @vitest-environment node
import { vi } from 'vitest'
import type { HistoryPost } from '../../src/lib/xAutopilot/types.js'
import { emptyRow, type AutopilotPatch, type AutopilotRow, type AutopilotStore } from './autopilotStore.js'
import type { EngineDeps } from './autopilotEngine.js'
import type { OwnPost } from './xClient.js'

// 自動運転のテストで共用する、偽の保存先・偽のX・偽のAI（テスト専用。本番の関数には含まれない）。

export const OWNER = 'user-1'
export const NOW = new Date('2026-10-10T03:00:00.000Z') // 12:00 JST
export const PROFILE = {
  summary: 'ゆるい独り言が多い',
  voice: { person: '特になし', endings: ['〜かも'], emoji: 'ほぼ使わない', layout: '短い1〜2文' },
  themes: [{ name: '朝の気分', note: '短くつぶやく' }],
  avoid: [],
}

export function history(n: number, start = 1): HistoryPost[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(1000 + start + i),
    text: `過去の投稿その${start + i}、今日はなんだか眠いかも`,
    at: new Date(Date.UTC(2026, 8, 1, 0, 0) + (start + i) * 3600_000).toISOString(),
    likes: i % 5,
    reposts: 0,
  })).sort((a, b) => b.at.localeCompare(a.at))
}

export function memoryStore(initial?: Partial<AutopilotRow>) {
  const rows = new Map<string, AutopilotRow>([[OWNER, { ...emptyRow(OWNER), ...initial }]])
  const posts: { userId: string; at: string; text: string; slotKey: string; status: string }[] = []
  const account = { xUserId: '555', username: 'me' }
  const store: AutopilotStore & { rows: typeof rows; posts: typeof posts; hasAccount: boolean } = {
    rows,
    posts,
    hasAccount: true,
    async get(userId) {
      return structuredClone(rows.get(userId) ?? emptyRow(userId))
    },
    async save(userId, patch: AutopilotPatch) {
      rows.set(userId, { ...(rows.get(userId) ?? emptyRow(userId)), ...structuredClone(patch) })
    },
    async listEnabled() {
      return [...rows.values()].filter((r) => r.enabled).map((r) => structuredClone(r))
    },
    async xAccount() {
      return store.hasAccount ? account : null
    },
    async insertPost(input) {
      if (posts.some((p) => p.userId === input.userId && p.slotKey === input.slotKey)) return 'duplicate'
      posts.push({ ...input, status: 'scheduled' })
      return 'inserted'
    },
    async recentTexts(userId, limit) {
      return posts
        .filter((p) => p.userId === userId && p.status !== 'canceled')
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit)
        .map((p) => ({ text: p.text, at: p.at }))
    },
    async cancelUpcoming(userId) {
      let n = 0
      for (const p of posts) {
        if (p.userId !== userId || p.status !== 'scheduled') continue
        p.status = 'canceled'
        n++
      }
      return n
    },
  }
  return store
}

// 偽のAIは、毎回まったく違う文を返す（似た文を返すと、本物の「似すぎ」の検査に弾かれる）。
export const WRITTEN = [
  '雨の日は温かいコーヒーが飲みたくなる',
  '電車の窓から見えた夕焼けがきれいだった',
  '夜更かしをして、ちょっとだけ後悔してる',
  '散歩の途中で立ち寄ったパン屋さんが好き',
  '最近は早起きがだんだん楽しくなってきた',
  '読みかけの本をやっと最後まで読み切った',
  '久しぶりに友達と長電話して笑いすぎた',
  '休日はひたすら何もしない贅沢を味わう',
  '新しいイヤホンの音がびっくりするほど良い',
  '台所から煮物のいい匂いがしてきて幸せ',
  '帰り道の空気が冷たくて秋を感じた',
  '今週もなんとか乗り切れたので自分をほめる',
]
let counter = 0
/** 偽のAIが次に返す文を、最初に戻す。テストごとに呼ぶ。 */
export function resetWritten() {
  counter = 0
}
export function makeDeps(store: ReturnType<typeof memoryStore>, over: Partial<EngineDeps> = {}) {
  const writePost = vi.fn(async (input: { onUsage?: (u: { inputTokens: number; outputTokens: number }) => void }) => {
    input.onUsage?.({ inputTokens: 4000, outputTokens: 1200 })
    return WRITTEN[counter++ % WRITTEN.length]
  })
  const writeProfile = vi.fn(async (input: { onUsage?: (u: { inputTokens: number; outputTokens: number }) => void }) => {
    input.onUsage?.({ inputTokens: 15000, outputTokens: 5000 })
    return PROFILE
  })
  const fetchOwnPosts = vi.fn(async (): Promise<OwnPost[]> => [])
  const deps: EngineDeps = {
    store,
    now: () => NOW,
    apiKey: () => 'key',
    getAccessToken: async () => 'token',
    fetchOwnPosts,
    writeProfile: writeProfile as unknown as EngineDeps['writeProfile'],
    writePost: writePost as unknown as EngineDeps['writePost'],
    ...over,
  }
  return { deps, writePost, writeProfile, fetchOwnPosts }
}


export const ready = (patch: Partial<AutopilotRow> = {}) =>
  memoryStore({ enabled: true, profile: PROFILE, history: history(40), ...patch })
