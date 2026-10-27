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
  // 既定は「確認なしで、時刻になれば投稿」（requireApproval: false）。確認ありの動きは、そのテストで initial に指定する。
  const base = emptyRow(OWNER)
  const rows = new Map<string, AutopilotRow>([
    [OWNER, { ...base, settings: { ...base.settings, requireApproval: false }, ...initial }],
  ])
  // rejected: 本人が「取り消す」で外したもの（本物では error_message の印）。「自動運転を止める」での一括の取り消しには付かない
  // postedTweetIds: 投稿済みになったときの X の投稿の番号（本物では posted_tweet_ids）
  const posts: {
    userId: string
    at: string
    text: string
    slotKey: string
    status: string
    rejected?: boolean
    postedTweetIds?: string[]
  }[] = []
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
      // 本物の索引（007）と同じく、取り消した予約は数えない。数えると、設定を変えて作り直すときに同じ枠が重複扱いになる。
      if (posts.some((p) => p.userId === input.userId && p.slotKey === input.slotKey && p.status !== 'canceled')) return 'duplicate'
      posts.push({ ...input, status: input.status ?? 'scheduled' })
      return 'inserted'
    },
    async recentTexts(userId, limit) {
      return posts
        .filter((p) => p.userId === userId && p.status !== 'canceled')
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit)
        .map((p) => ({ text: p.text, at: p.at }))
    },
    async rejectedTexts(userId, limit) {
      return posts
        .filter((p) => p.userId === userId && p.status === 'canceled' && p.rejected)
        .reverse() // あとから取り消したものが新しい
        .slice(0, limit)
        .map((p) => p.text)
    },
    async autopilotTweetIds(userId, limit) {
      return posts
        .filter((p) => p.userId === userId && p.status === 'posted')
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit)
        .flatMap((p) => p.postedTweetIds ?? [])
    },
    async rejectedSlotKeys(userId, sinceDate) {
      return posts
        .filter((p) => p.userId === userId && p.status === 'canceled' && p.rejected && p.slotKey.slice(0, 10) >= sinceDate)
        .map((p) => p.slotKey)
    },
    async activeSlotKeys(userId, sinceDate) {
      return posts
        .filter((p) => p.userId === userId && p.status !== 'canceled' && p.slotKey.slice(0, 10) >= sinceDate)
        .map((p) => p.slotKey)
    },
    async trimDrafts(userId, keep) {
      const drafts = posts.filter((p) => p.userId === userId && p.status === 'draft')
      const extra = drafts.slice(keep)
      for (const p of extra) p.status = 'canceled'
      return extra.length
    },
    async draftCount(userId) {
      return posts.filter((p) => p.userId === userId && p.status === 'draft').length
    },
    async cancelUpcoming(userId) {
      let n = 0
      for (const p of posts) {
        if (p.userId !== userId || (p.status !== 'scheduled' && p.status !== 'draft')) continue
        p.status = 'canceled'
        n++
      }
      return n
    },
    async approveUpcoming(userId) {
      let n = 0
      for (const p of posts) {
        if (p.userId !== userId || p.status !== 'draft') continue
        p.status = 'scheduled'
        n++
      }
      return n
    },
  }
  return store
}

// 偽のAIは、毎回まったく違う文を返す（似た文を返すと、本物の「似すぎ」の検査に弾かれる）。
export const WRITTEN = [
  '温かいコーヒーを淹れる時間が一日で一番好き',
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
  const writePost = vi.fn(async (input: { onUsage?: (u: { inputTokens: number; outputTokens: number }) => void; length?: { min: number; max: number } }) => {
    input.onUsage?.({ inputTokens: 4000, outputTokens: 1200 })
    const i = counter++
    let text = WRITTEN[i % WRITTEN.length]
    // 指定された長さ（枠ごとに違う）の範囲に入るよう、別の文を足す（足す文は番号ごとに違うので、似すぎの検査には当たらない）
    for (let k = 1; input.length && [...text].length < input.length.min + 2 && k < 12; k++) {
      text += `。${WRITTEN[(i * 7 + k * 5) % WRITTEN.length]}（${i}-${k}）`
    }
    return text
  })
  const writeProfile = vi.fn(async (input: { onUsage?: (u: { inputTokens: number; outputTokens: number }) => void }) => {
    input.onUsage?.({ inputTokens: 15000, outputTokens: 5000 })
    return PROFILE
  })
  const revisePost = vi.fn(async (input: { text: string; onUsage?: (u: { inputTokens: number; outputTokens: number }) => void }) => {
    input.onUsage?.({ inputTokens: 3000, outputTokens: 300 })
    return `${input.text}（整えた）`
  })
  const composePost = vi.fn(async (input: { material: string; onUsage?: (u: { inputTokens: number; outputTokens: number }) => void }) => {
    input.onUsage?.({ inputTokens: 3000, outputTokens: 300 })
    return `${input.material}って、いいよね`
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
    revisePost: revisePost as unknown as EngineDeps['revisePost'],
    composePost: composePost as unknown as EngineDeps['composePost'],
    ...over,
  }
  return { deps, writePost, writeProfile, revisePost, composePost, fetchOwnPosts }
}


export const ready = (patch: Partial<AutopilotRow> = {}) =>
  memoryStore({ enabled: true, profile: PROFILE, history: history(40), ...patch })
