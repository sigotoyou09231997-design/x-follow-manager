import { WRITING_RULES, writePosts, type GeneratedPost } from './postWriter.js'

// 「毎日投稿する」ための本文づくり。
// 繰り返し予約は本来テンプレートの本文をそのまま複製するので、毎日同じ文章が出てしまう。
// AIおまかせをONにした繰り返しでは、1回ぶんを作るたびにここで新しい文章を書く。

/** 同じ話の繰り返しを避けるために、直近何件の投稿をAIへ見せるか。 */
export const RECENT_POSTS_TO_AVOID = 10

export interface DailyWriteInput {
  /** 「何について書くか」。テンプレートに保存されたお題。 */
  topic: string
  /** この繰り返しで直近に投稿した本文（新しい順）。同じ内容を書かせないために渡す。 */
  recentTexts: string[]
  /** 投稿予定日。曜日や季節が本文に効くお題のために渡す。 */
  scheduledAt: string
  timeZone: string
}

export function buildDailySystemPrompt(): string {
  return `あなたはX(旧Twitter)で毎日投稿している人の代わりに、その日の投稿を1本書きます。

前提:
- ユーザーは「毎日これについて投稿したい」というお題だけを登録していて、
  今日の投稿の中身を1件ずつ考えてはいない。何を書くかを決めるところまでがあなたの仕事
- 書いたものは人の目を通さずそのまま投稿される。確認を求める文や、選択肢の提示を書かない

お題の扱い:
- お題は「毎回の題材」であって、そのまま投稿する文ではない。毎回、別の角度から1本書く
- お題に書かれていない事実を作らない。数字・出来事・固有名詞・実績・体験談を
  でっち上げない。本人が言っていない意見を代弁しない。
  これは毎日そのまま本人の名前で出るため、作り話が混ざると本人が嘘をついたことになる
- 具体的な事実を足せないぶん、切り口・語りかけ方・話の順序で変化をつける
- 「最近投稿したもの」が渡された場合、そこで言った中身は繰り返さない。
  毎日読む人には、同じことを言い換えているだけだとすぐ分かる
- ただし、あいさつ・名乗り・決まり文句のように、お題が「毎回入れる」ことを
  求めているものは毎回入れる。変えるのはそのあとに続く中身のほう。
  お題が毎朝のあいさつなら「おはよう」は毎日書く（前と同じだからと外さない）

出力の形:
- posts 配列に案を1つだけ入れる
- segments は必ず1要素だけにする（単発投稿）
- note には「どういう切り口か」を日本語で15字程度で書く

${WRITING_RULES}`
}

/** 「8月28日（木）」のような、その日を人が読む形。曜日はお題に効くことがある。 */
function describeDay(scheduledAt: string, timeZone: string): string {
  const date = new Date(scheduledAt)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return date.toLocaleDateString('ja-JP', {
      timeZone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    })
  } catch {
    // 保存されたタイムゾーン名が実行環境で解決できないことがある。
    // 日付が出せないだけで投稿は作れるので、ここで生成を止めない。
    return date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
  }
}

export function buildDailyUserMessage(input: DailyWriteInput): string {
  const sections: string[] = [`お題(毎回の題材):\n${input.topic.trim()}`]

  const day = describeDay(input.scheduledAt, input.timeZone)
  if (day) sections.push(`投稿する日: ${day}`)

  const recent = input.recentTexts.map((text) => text.trim()).filter(Boolean)
  if (recent.length > 0) {
    sections.push(
      `最近投稿したもの(新しい順。同じ話題・同じ書き出しを繰り返さない):\n${recent
        .map((text, i) => `【${i + 1}】\n${text}`)
        .join('\n\n')}`
    )
  } else {
    sections.push('最近投稿したもの: まだない（この繰り返しの1本目）')
  }

  return sections.join('\n\n')
}

/**
 * その日ぶんの本文を1件書かせる。
 * 案を選ぶ人がいない一発勝負なので、複数案は作らせず1本に絞る。
 */
export async function writeDailyPost(
  apiKey: string,
  input: DailyWriteInput,
  timeoutMs: number
): Promise<GeneratedPost | undefined> {
  const posts = await writePosts({
    apiKey,
    system: buildDailySystemPrompt(),
    user: buildDailyUserMessage(input),
    // 毎日1回、無人で走り続ける。案を選ぶ余地がないぶん質は要るが、
    // 深い推論を要する仕事ではないので画面からの生成と同じ medium に留める。
    effort: 'medium',
    timeoutMs,
  })
  const post = posts[0]
  if (!post) return undefined
  // 単発投稿として出すので、複数segmentが返ってきても1つ目だけを使う。
  return { segments: post.segments.slice(0, 1), note: post.note }
}
