// X予約投稿機能で使う型。Supabase の scheduled_posts テーブルと1対1で対応する。

/** 添付画像1枚。実体はSupabase Storageの `x-post-media` バケットに置く。 */
export interface PostMedia {
  /** Storage内のパス。必ず `<user_id>/<uuid>.<ext>` の形（RLSがフォルダ名で本人確認するため）。 */
  path: string
  mime: string
  /** 一覧やコンポーザーでのサムネイル表示用。署名付きURLなので有効期限がある。 */
  previewUrl?: string
  /** 画像の代替テキスト。設定するとXにも alt text として登録される。 */
  altText?: string
}

/**
 * 投稿1件分の本文。スレッド（連投）は segments を複数持つことで表現し、
 * 単発投稿は要素1つだけの配列になる。こうしておくと「あとからスレッドに
 * 伸ばす」がデータ構造の変更なしにできる。
 */
export interface PostSegment {
  text: string
  /** Xの仕様上、1投稿に添付できる画像は最大4枚。 */
  media: PostMedia[]
}

export type RepeatFreq = 'daily' | 'weekly' | 'monthly'

/**
 * 繰り返し予約のルール。これを持つ行は「テンプレート」であり、それ自体は投稿されない。
 * 次回分の実体行が repeat_parent_id 付きで随時生成される。
 */
export interface RepeatRule {
  freq: RepeatFreq
  /** 何回ごとか。2 なら隔日・隔週・隔月。 */
  interval: number
  /** weekly のときの曜日（0=日曜〜6=土曜）。複数指定可。 */
  byWeekday?: number[]
  /** monthly のときの日付（1〜31）。月末に足りない月はスキップする。 */
  byMonthday?: number
  /** "HH:mm"。timeZone のローカル時刻として解釈する。 */
  time: string
  timeZone: string
  /** "YYYY-MM-DD"。この日を過ぎたら生成を止める。未指定なら無期限。 */
  until?: string
  /**
   * 各回の本文をAIに書かせる。毎日投稿するために作った仕組みで、
   * ONのときテンプレートは本文を持たず、1回ぶんを作るたびにAIが新しい文章を書く。
   * OFF（既定）だと毎回まったく同じ文面が投稿される。
   */
  autoGenerate?: boolean
  /**
   * autoGenerate のときの「何について書くか」。
   * ai_prompt 列ではなくルールの中に持たせているのは、繰り返しの設定を1つの
   * オブジェクトとして読み書きしているため。分けて持つと、片方だけ更新されて
   * 「AIおまかせなのにお題が空」という投稿できない状態が作れてしまう。
   */
  aiTopic?: string
}

export type ScheduledPostStatus =
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'posted'
  | 'failed'
  | 'canceled'

export interface ScheduledPost {
  id: string
  userId: string
  status: ScheduledPostStatus
  /** ISO8601。status が 'scheduled' のときは必須。 */
  scheduledAt?: string
  segments: PostSegment[]
  repeatRule?: RepeatRule
  repeatParentId?: string
  postedTweetIds?: string[]
  errorMessage?: string
  attemptCount: number
  aiPrompt?: string
  createdAt: string
  updatedAt: string
}

/** 一覧画面の上部に出すサマリ。「今どれくらい予約してるか」を一目で見せる。 */
export interface ScheduleSummary {
  draft: number
  scheduled: number
  posted: number
  failed: number
  /** 繰り返しテンプレートの数（scheduled には含めない）。 */
  repeating: number
  /** 直近の予約時刻（ISO8601）。予約が0件なら undefined。 */
  nextScheduledAt?: string
  /** 今日これから投稿される予定の件数。 */
  dueToday: number
}

export interface XAccountStatus {
  xUserId: string
  username: string
  connectedAt: string
}
