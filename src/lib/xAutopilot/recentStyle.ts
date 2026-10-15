import type { HistoryPost } from './types'

// 「最近の書き方の傾向」と「話題の偏り」を、投稿の履歴から**毎回**計算する。AI は呼ばない（無料で、いつも最新）。
//
// なぜ要るか:
//   ・書き方は時期で変わる（2025年は投稿の3〜4割が「おはようございます🍋」始まりだったが、2026年は0件）。
//     voiceGuide.ts の文字は、書いた時点の分析で、いずれ古くなる。数字は最新の履歴から毎回出して、AI に渡す。
//   ・AI は、話題を自分で選ぶと、直近に多い話題（実例: ハイボール・ジンソーダなどお酒の話）に偏り、
//     しかも自動運転が出した投稿が履歴に戻って次のお手本になり、偏りが自分で自分を強めた。
//     「最近多すぎる話題」を数えて避けさせ、「ふだん書くのに最近出ていない話題」を教える。
// サーバー（api/）と画面（src/）の両方から使えるよう、保存先や通信には依存しない。

/** 傾向を数える、新しい順の件数。 */
export const STYLE_SAMPLE_SIZE = 40
/** これより少ない集計は、特徴ではなく偶然を拾う。 */
const MIN_FOR_STYLE = 8

const clean = (text: string) => text.replace(/https?:\/\/\S+/g, '').trim()
const percent = (n: number, total: number) => Math.round((n / total) * 100)
const at = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]

/** 直近の投稿から、長さ・句読点・絵文字などの割合を数えて、AI に渡す文にする。少なすぎれば undefined。 */
export function describeRecentStyle(history: HistoryPost[], size = STYLE_SAMPLE_SIZE): string | undefined {
  const texts = history
    .slice(0, size)
    .map((p) => clean(p.text))
    .filter(Boolean)
  if (texts.length < MIN_FOR_STYLE) return undefined

  const lens = texts.map((t) => [...t].length).sort((a, b) => a - b)
  const lines = texts.map((t) => t.split('\n').filter((l) => l.trim()).length).sort((a, b) => a - b)
  const share = (f: (t: string) => boolean) => percent(texts.filter(f).length, texts.length)

  return [
    `直近${texts.length}件の集計（本人が自分で書いた投稿。自動運転が出した分は入れていない。毎回、最新の履歴から計算している）:`,
    `- 長さ: 中央値${at(lens, 0.5)}字（${at(lens, 0.25)}〜${at(lens, 0.75)}字が中心）。行数は中央値${at(lines, 0.5)}行`,
    `- 句点「。」で終わる ${share((t) => /。$/.test(t))}%／「！」を含む ${share((t) => /[!！]/.test(t))}%／疑問形 ${share((t) => /[?？]/.test(t))}%／絵文字 ${share((t) => /\p{Extended_Pictographic}/u.test(t))}%／ハッシュタグ ${share((t) => /[#＃]/.test(t))}%`,
    `- 「w」「草」を含む ${share((t) => /草|[wｗ]/.test(t))}%／「笑」を含む ${share((t) => /笑/.test(t))}%／「おはよう」で始まる ${share((t) => /^おは/.test(t))}%`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 話題の括り。大きめの括りで数える（「ハイボール」も「ジンソーダ」も「晩酌」も、どれも「お酒」）。
// 言葉の一致なので粗いが、目的は「この括りが続いている」を知らせること。判断はAIに任せる。

interface Topic {
  name: string
  words: string[]
}

export const TOPICS: Topic[] = [
  {
    name: 'お酒・晩酌',
    words: ['ハイボール', 'ジンソーダ', 'ジントニック', 'ビール', 'ウイスキー', 'ウィスキー', '日本酒', 'ワイン', 'サワー', 'チューハイ', '酎ハイ', '焼酎', '晩酌', '飲み会', 'お酒', '酒'],
  },
  {
    name: '食べ物・飲み物',
    words: ['美味', 'うまい', 'ご飯', 'ごはん', 'ラーメン', 'カレー', '丼', '寿司', 'おにぎり', '弁当', 'ランチ', 'お昼', '朝ごはん', '食べ', '料理', 'スイーツ', 'ケーキ', 'コンビニ', 'マック', 'スタバ', 'コーヒー', 'カフェ', 'じゃがりこ', '納豆', 'サラダ', '鍋', '飲み物', 'ジュース'],
  },
  {
    name: '会社・仕事',
    words: ['会社', '仕事', '上司', '同僚', '出社', '退勤', '残業', '会議', '朝礼', '有給', '転職', '営業', '客先', '職場', 'テレワーク', 'リモート'],
  },
  {
    name: 'ゲーム',
    words: ['ゲーム', 'パズドラ', 'Switch', 'switch', 'ガチャ', 'ダンジョン', 'PUBG', 'スプラ', 'トモコレ', 'トモダチコレクション', 'モンスト', 'フレンド', 'ランク', 'UFOキャッチャー'],
  },
  { name: 'お金・税金', words: ['税金', '給料', 'お金', '値上げ', '高すぎ', '高過ぎ', '節約', 'ボーナス', '物価', '年間', '円'] },
  { name: '体調・睡眠', words: ['眠', '寝', '疲', 'お腹', '頭痛', '体調', '風邪', '腰', '肩', 'だるい', 'ダルい'] },
  { name: '天気・季節', words: ['暑', '寒', '雨', '台風', '天気', '気温', '秋', '冬'] },
  { name: 'お出かけ・旅行', words: ['旅行', 'ユニバ', 'ディズニー', '温泉', '足湯', '観光', 'ドライブ', '行ってきた', '来ました'] },
  { name: 'アプリ・IT', words: ['アプリ', 'iOS', 'iPhone', 'AI', 'プログラ', 'エンジニア', 'コード', 'ChatGPT', 'Claude', 'ホームページ'] },
  { name: '電車・通勤', words: ['電車', '駅', '通勤', '満員', 'バス'] },
]

export interface TopicCount {
  name: string
  /** この括りに当てはまった投稿の数。 */
  count: number
  /** 数えた投稿の数。 */
  total: number
  /** 当てはまった言葉（多い順）。画面・AI への説明に使う。 */
  words: { word: string; count: number }[]
}

/** 投稿を話題の括りごとに数える。1つの投稿が複数の括りに入ることもある。 */
export function countTopics(texts: string[]): TopicCount[] {
  const total = texts.length
  return TOPICS.map((topic) => {
    const perWord = new Map<string, number>()
    let count = 0
    for (const text of texts) {
      const hits = topic.words.filter((w) => text.includes(w))
      if (hits.length === 0) continue
      count++
      for (const w of hits) perWord.set(w, (perWord.get(w) ?? 0) + 1)
    }
    const words = [...perWord].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([word, n]) => ({ word, count: n }))
    return { name: topic.name, count, total, words }
  })
}

/** 多すぎる括り: minCount 件以上、かつ全体の minShare 以上。多い順。 */
export function crowdedTopics(texts: string[], options: { minCount: number; minShare: number }): TopicCount[] {
  if (texts.length === 0) return []
  return countTopics(texts)
    .filter((t) => t.count >= options.minCount && t.count / t.total >= options.minShare)
    .sort((a, b) => b.count - a.count)
}

/**
 * 「最近少ない話題」として勧めない括り。天気は書かない決まり（text.ts の uncertainIn）なので、
 * 本人が天気の話をよく書いていて最近出ていないだけで勧めると、AI に「天気を書け」と「天気を書くな」を同時に言うことになる。
 * 「最近多すぎる話題」には残す（天気の話を避けさせる向きは決まりと同じ）。
 */
const NOT_SUGGESTED = new Set(['天気・季節'])

/**
 * 少ない括り: 本人がふだん書く（履歴全体の5%以上・5件以上）のに、直近には1つも出ていないもの。
 * 本人が書かない括り（旅行など）を勧めると、無かった体験を作る原因になるので、履歴に根拠があるものだけにする。
 */
export function neglectedTopics(historyTexts: string[], recentTexts: string[], max = 3): string[] {
  if (historyTexts.length < 20) return []
  const recent = new Map(countTopics(recentTexts).map((t) => [t.name, t.count]))
  return countTopics(historyTexts)
    .filter((t) => !NOT_SUGGESTED.has(t.name))
    .filter((t) => t.count >= 5 && t.count / t.total >= 0.05 && (recent.get(t.name) ?? 0) === 0)
    .sort((a, b) => b.count / b.total - a.count / a.total)
    .slice(0, max)
    .map((t) => t.name)
}

/** 多すぎる括りを、AI に渡す1行にする。例: 「お酒・晩酌（直近12件のうち5件。ハイボール×4・ジンソーダ×1）」 */
export function describeCrowded(topic: TopicCount): string {
  const words = topic.words.map((w) => `${w.word}×${w.count}`).join('・')
  return `${topic.name}（直近${topic.total}件のうち${topic.count}件${words ? `。${words}` : ''}）`
}

/** 同じ括りが、別の集計から重ねて出たときは、多いほうだけ残す。 */
export function mergeCrowded(lists: TopicCount[][]): TopicCount[] {
  const byName = new Map<string, TopicCount>()
  for (const t of lists.flat()) {
    const have = byName.get(t.name)
    if (!have || t.count / t.total > have.count / have.total) byName.set(t.name, t)
  }
  return [...byName.values()].sort((a, b) => b.count / b.total - a.count / a.total)
}
