// 自動運転の話題を、同じ所に偏らせず、まだ書いたことのない題材へ広げるための部品（AIは呼ばない）。
//   ・使いすぎの言葉: 最近の投稿で何度も出ている言葉（「焼き芋」「ハイボール」など）。今回は使わせない。
//   ・まだ書いたことがない題材: 過去の投稿に1度も出ていない、ふだんの題材の候補。そこから選ばせる。

/** 「今日」「最近」のように、どの投稿にも出る言葉。使いすぎの言葉には数えない。 */
const STOP_WORDS = new Set([
  '一日', '今日', '昨日', '明日', '最近', '今年', '今週', '今夜', '今回', '毎日', '毎回', '時間', '自分', '普通', '本当', '一番', '全然',
  '結局', '一回', '一個', '二個', '何回', '何度', '何か', '何も', '気分', '感じ', '場合', '以上', '以下', '以外', '今度', 'たまに',
  'ちょっと', 'そろそろ', 'ほんと', 'やっぱり', 'やっぱ', 'なんか', 'たぶん', 'まじで', 'めっちゃ', 'とりあえず', 'ほとんど',
  'ありがとう', 'おはよう', 'こんにち', 'こんばん', 'お疲れ', 'ツイート', 'ポスト', 'リプ', 'フォロー', 'フォロワー',
])

// 漢字の連なり（間に、ひらがなが2文字まで入ってよい: 焼き芋・買い物）か、カタカナの連なり（ハイボール）。
const WORD = /[一-龠々][ぁ-ん]{0,2}[一-龠々]+|[ァ-ヶー]{3,}|[一-龠々]{2,}/g

/** 1つの文に出てくる言葉（重複は1つ）。 */
export function wordsOf(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.match(WORD) ?? []) {
    if (!STOP_WORDS.has(match) && match.length >= 2) found.add(match)
  }
  return [...found]
}

/**
 * 何本の投稿に出てきたか（同じ文の中で何度出ても1本）が minDocs 本以上の言葉を、多い順に。
 * 1本の中で繰り返しただけの言葉は数えない（偏りは、複数の投稿をまたいで出るもの）。
 */
export function frequentWords(texts: string[], minDocs: number, limit: number): string[] {
  const docs = new Map<string, number>()
  for (const text of texts) for (const word of wordsOf(text)) docs.set(word, (docs.get(word) ?? 0) + 1)
  return [...docs.entries()]
    .filter(([, count]) => count >= minDocs)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word)
}

/** 本文に含まれる、使いすぎの言葉。 */
export function overusedIn(text: string, words: string[]): string[] {
  return words.filter((word) => text.includes(word))
}

/**
 * まだ書いたことがない題材の候補。ふだんの生活の、体験談にならない題材（見たもの・思ったこと・世の中のあるある）。
 * キーワードのどれかが過去の投稿に出ていれば「書いたことがある」として、候補から外す。
 */
export const FRESH_THEMES: { theme: string; keywords: string[] }[] = [
  { theme: '電車や駅のアナウンスへの感想', keywords: ['アナウンス', '駅'] },
  { theme: '天気予報と実際の天気のずれ', keywords: ['天気予報', '予報'] },
  { theme: '洗濯物が乾かない季節の悩み', keywords: ['洗濯', '乾燥機'] },
  { theme: '図書館や本屋の静けさ', keywords: ['図書館', '本屋', '書店'] },
  { theme: '傘をなくしがちな話', keywords: ['傘'] },
  { theme: '目覚まし時計とスヌーズの攻防', keywords: ['スヌーズ', '目覚まし'] },
  { theme: '充電ケーブルがすぐ行方不明になる', keywords: ['ケーブル'] },
  { theme: 'エレベーターで一緒になった時の気まずさ', keywords: ['エレベーター'] },
  { theme: '郵便受けに入っているチラシ', keywords: ['チラシ', '郵便'] },
  { theme: '公園で見かける鳥や猫の様子', keywords: ['公園', '鳥', '野良'] },
  { theme: 'お風呂上がりの過ごし方', keywords: ['風呂上がり', '湯上がり'] },
  { theme: '自動ドアが反応してくれない', keywords: ['自動ドア'] },
  { theme: 'スーパーの試食コーナー', keywords: ['試食'] },
  { theme: '床屋や美容室での会話', keywords: ['美容室', '美容院', '床屋'] },
  { theme: '季節の変わり目の服選び', keywords: ['衣替え', '服選び'] },
  { theme: '自販機の新商品を見つけた時', keywords: ['新商品', '自販機'] },
  { theme: 'エアコンの設定温度の迷い', keywords: ['エアコン', '設定温度'] },
  { theme: '通知が来て確認すると広告だった', keywords: ['広告'] },
  { theme: '歩きスマホをしている人を避ける', keywords: ['歩きスマホ'] },
  { theme: '路線の乗り換えで迷う', keywords: ['乗り換え', '乗換'] },
  { theme: 'ゴミの日を忘れかけた朝', keywords: ['ゴミの日', 'ごみの日', '燃えるゴミ'] },
  { theme: '夜中に急に気になって調べ始めること', keywords: ['夜中', '深夜'] },
  { theme: '昔のゲームのBGMを急に思い出す', keywords: ['BGM'] },
  { theme: '待ち合わせの時間より早く着く癖', keywords: ['待ち合わせ'] },
  { theme: '手帳やカレンダーに予定を書き込むこと', keywords: ['手帳', 'カレンダー'] },
  { theme: 'ベランダや窓から見える景色', keywords: ['ベランダ'] },
  { theme: 'イヤホンの片方だけ聞こえない', keywords: ['イヤホン'] },
  { theme: '雨の日の信号待ち', keywords: ['信号'] },
  { theme: '食器棚や冷蔵庫の整理', keywords: ['冷蔵庫', '食器'] },
  { theme: '月や星の見え方', keywords: ['月', '星空', '満月'] },
]

/** 小さな文字列から、決まった0以上1未満の数を作る（FNV-1a）。同じ枠なら同じ候補、枠が違えば違う候補になる。 */
function hash01(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x1_0000_0000
}

/**
 * まだ書いたことがない題材を、n 個。過去の投稿（corpus）にキーワードが1つでも出ている題材は外す。
 * 選び方は seed で決まる（枠ごとに違う候補が出る。同じ枠の書き直しでは同じ）。
 */
export function pickFreshThemes(seed: string, n: number, corpus: string[]): string[] {
  const all = corpus.join('\n')
  return FRESH_THEMES.filter((t) => !t.keywords.some((k) => all.includes(k)))
    .map((t) => ({ theme: t.theme, order: hash01(`${seed}:${t.theme}`) }))
    .sort((a, b) => a.order - b.order)
    .slice(0, n)
    .map((t) => t.theme)
}
