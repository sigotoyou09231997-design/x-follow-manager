// X の「自動運転」（過去の投稿を読んで文体を学び、AIが新しい投稿を前もって予約に並べる）の共通の型と決まりごと。
// サーバー（api/）と画面（src/）の両方が使うので、保存先や通信に依存するものはここに置かない。

/** 自動運転で作った予約には、scheduled_posts.ai_prompt にこの接頭辞＋枠の印を入れる。一覧で見分け、枠を数えるための目印。 */
export const AUTOPILOT_PREFIX = 'autopilot:'

export const isAutopilotPost = (aiPrompt: string | null | undefined): boolean =>
  !!aiPrompt && aiPrompt.startsWith(AUTOPILOT_PREFIX)

/** 文章の質。標準＝高い精度、節約＝費用を抑える（短い投稿なら差は小さい）。使うAIと料金は cost.ts。 */
export type Quality = 'standard' | 'saver'

export interface AutopilotSettings {
  /** 1日の投稿数。1〜8（多すぎる連投は、費用だけでなく X 側のスパム判定にも近づく）。 */
  postsPerDay: number
  /** 投稿する時間帯の始まり・終わり（その地域の時刻 'HH:mm'）。枠はこの中に散らす。 */
  windowStart: string
  windowEnd: string
  timeZone: string
  /** 何日先まで前もって予約に並べるか。1〜3。 */
  horizonDays: number
  /** 1か月に使ってよい金額（円）の目安。超えそうになったら新しい投稿を作らない。 */
  monthlyBudgetYen: number
  quality: Quality
}

export const DEFAULT_SETTINGS: AutopilotSettings = {
  postsPerDay: 3,
  windowStart: '08:00',
  windowEnd: '23:00',
  timeZone: 'Asia/Tokyo',
  horizonDays: 2,
  monthlyBudgetYen: 3000,
  quality: 'standard',
}

export const LIMITS = {
  postsPerDay: { min: 1, max: 8 },
  horizonDays: { min: 1, max: 3 },
  monthlyBudgetYen: { min: 300, max: 50_000 },
  /** 枠と枠の最小間隔（分）。連投に見えないための下限。 */
  minGapMinutes: 30,
} as const

/** 読み込んだ自分の過去の投稿1件。 */
export interface HistoryPost {
  id: string
  text: string
  /** 投稿された時刻（ISO8601）。 */
  at: string
  likes: number
  reposts: number
}

/** AIが履歴からまとめた、この人らしさ。画面にそのまま見せるので、人が読める文にする。 */
export interface StyleProfile {
  /** 全体の印象を1〜2文で。 */
  summary: string
  voice: {
    /** 一人称・呼びかけの癖。 */
    person: string
    /** よく使う語尾・口癖。 */
    endings: string[]
    /** 絵文字・記号の使い方。 */
    emoji: string
    /** 1本の長さ・改行の癖。 */
    layout: string
  }
  /** よく書く話題。 */
  themes: { name: string; note: string }[]
  /** 履歴から読み取れる「やらないこと」（書かない話題・避ける言い回し）。 */
  avoid: string[]
}

/** 今月ぶんの使用状況（見積もり）。 */
export interface AutopilotUsage {
  /** 'YYYY-MM'（その地域の月）。月が変わったら 0 から数え直す。 */
  month: string
  yen: number
  posts: number
  generations: number
}

export const emptyUsage = (month: string): AutopilotUsage => ({ month, yen: 0, posts: 0, generations: 0 })

/** 画面が受け取る、自動運転の現在の状態。履歴の中身そのものは送らず、件数と日付だけ（大きいため）。 */
export interface AutopilotState {
  enabled: boolean
  settings: AutopilotSettings
  /** 連携中の X アカウント。無ければ null。 */
  xAccount: { username: string } | null
  history: { total: number; fetchedAt: string | null; newestAt: string | null; oldestAt: string | null }
  profile: StyleProfile | null
  profileBuiltAt: string | null
  /** 今月ぶん（月が変わっていれば 0 からの値）。 */
  usage: AutopilotUsage
  /** 補充を止めている理由。無ければ null。 */
  lastError: string | null
}
