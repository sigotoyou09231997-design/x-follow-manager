import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { requireUserId, UnauthorizedError } from './_lib/auth.js'
import { anthropicApiKey, apiKeyShape, RefusedError, WRITING_RULES, writePosts } from './_lib/postWriter.js'

interface GenerateBody {
  /**
   * ユーザーがAIに伝えたいこと。思いついた順のメモや箇条書きのまま来る前提の自由文で、
   * 文体の希望（「淡々と」「絵文字なし」）が混ざっていることもある。
   */
  message?: string
  /** message の旧名。古い画面から呼ばれたときのために残す。 */
  topic?: string
  /** 生成する案の数。 */
  count?: number
  /** 'single' = 単発投稿を count 件、'thread' = スレッドを count 本 */
  mode?: 'single' | 'thread'
  /** スレッド1本あたりの投稿数の目安。 */
  threadLength?: number
  /** 「丁寧」「カジュアル」など文体の指定。いまの画面は message に混ぜて書いてもらう。 */
  tone?: string
  /** 自分の過去投稿。文体を寄せるためのお手本として渡す。 */
  styleExamples?: string[]
  /** 作り直しのとき、いま画面に出ている本文。「これもっと短く」等の指示語の参照先になる。 */
  currentText?: string
  /** 追加の指示。 */
  instructions?: string
}

export function buildSystemPrompt(mode: 'single' | 'thread', threadLength: number): string {
  const shape =
    mode === 'thread'
      ? `1つの案につき ${threadLength} 個前後の segments を作り、スレッド(連投)として読んで筋が通るようにする。1つ目のsegmentだけで内容が要約されていて、単体でも読む価値があるようにする。`
      : `1つの案につき segments は必ず1要素だけにする。`

  return `あなたはX(旧Twitter)の投稿文を書くアシスタントです。
ユーザーは「伝えたいこと」を書きます。整った文章とはかぎらず、思いついた順のメモ、箇条書き、
言い切っていない断片のこともあります。それを、そのまま投稿できる文章に仕立てるのがあなたの仕事です。

伝えたいことの扱い:
- 書かれている要素は落とさない。字数に入りきらないときは、細部を削って幹を残す
- 書かれていないことを足さない。数字・出来事・固有名詞・実績を勝手に作らない。
  本人が書いていない感情や意見を代弁しない
- 文体や長さの希望(「淡々と」「絵文字なし」「短めに」など)が混ざっていたら、それは伝えたい中身ではなく
  指示として扱う。その言葉自体を投稿本文に入れない
- メモの語順やそっけない書き方は、そのまま投稿の語順にしなくてよい。読み手に届く並びに組み直す

出力の形:
- posts 配列に、指定された数だけ案を入れる
- ${shape}
- note には「どういう切り口の案か」を日本語で15字程度で書く(例: 「体験談から入る」「数字で驚かせる」)

${WRITING_RULES}`
}

/** message（旧: topic）。画面が1つの入力欄にまとまる前の呼び出しにも答えられるようにしておく。 */
export function readMessage(payload: GenerateBody): string {
  return (payload.message ?? payload.topic ?? '').trim()
}

export function buildUserMessage(payload: GenerateBody, count: number): string {
  const sections: string[] = [`伝えたいこと:\n${readMessage(payload)}`, `作る案の数: ${count}`]
  if (payload.tone?.trim()) sections.push(`文体の指定:\n${payload.tone.trim()}`)
  if (payload.styleExamples?.length) {
    sections.push(
      `過去の投稿例(書き方の参考。内容は流用しない):\n${payload.styleExamples
        .map((ex, i) => `【例${i + 1}】\n${ex.trim()}`)
        .join('\n\n')}`
    )
  }
  if (payload.currentText?.trim()) {
    sections.push(
      `現在の本文(直前に生成し、ユーザーが今画面で見ているもの。追加指示の「これ」「この部分」はここを指す):\n${payload.currentText.trim()}`
    )
  }
  if (payload.instructions?.trim()) {
    sections.push(`追加の指示(必ず反映する):\n${payload.instructions.trim()}`)
  }
  return sections.join('\n\n')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    await requireUserId(req.headers.authorization)
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : 500
    return res.status(status).json({ error: (error as Error).message })
  }

  const apiKey = anthropicApiKey()
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY が設定されていません' })
  }

  let payload: GenerateBody
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  } catch {
    return res.status(400).json({ error: 'リクエストの形式が不正です' })
  }

  if (!readMessage(payload)) {
    return res.status(400).json({ error: 'AIに伝えたいことを入力してください' })
  }

  const count = Math.min(Math.max(Math.floor(payload.count ?? 3), 1), 10)
  const mode = payload.mode === 'thread' ? 'thread' : 'single'
  const threadLength = Math.min(Math.max(Math.floor(payload.threadLength ?? 3), 2), 10)

  try {
    const generated = await writePosts({
      apiKey,
      system: buildSystemPrompt(mode, threadLength),
      user: buildUserMessage(payload, count),
      // 費用の大半は思考トークン。投稿文の作成は深い推論を要さないので medium にしている。
      // 案の質が物足りなければ 'high'（費用は約2倍）、もっと安くしたければ 'low'。
      effort: 'medium',
    })

    if (generated.length === 0) {
      return res.status(502).json({ error: 'AIから投稿案を取得できませんでした。もう一度お試しください' })
    }

    // 単発モードで複数segmentが返ってきた場合に備えて形を揃える。
    const posts = generated.map((post) => ({
      segments: mode === 'single' ? post.segments.slice(0, 1) : post.segments,
      note: post.note,
    }))

    return res.status(200).json({ posts })
  } catch (error) {
    if (error instanceof RefusedError) {
      return res.status(422).json({
        error: 'この内容では投稿文を生成できませんでした。伝えたいことを書き換えてお試しください。',
      })
    }
    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'AIの利用制限に達しました。しばらく待ってお試しください' })
    }
    if (error instanceof Anthropic.AuthenticationError) {
      // Anthropicが鍵そのものを拒否した状態。残高不足ではこのエラーにはならない
      // （その場合は下のAPIErrorでメッセージがそのまま出る）。
      return res.status(500).json({
        error:
          'Anthropic APIキーが拒否されました（401）。console.anthropic.com で有効な鍵か確認してください。' +
          ` / 設定値の形: ${apiKeyShape()}`,
      })
    }
    if (error instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `AI呼び出しに失敗しました: ${error.message}` })
    }
    return res.status(500).json({ error: (error as Error).message })
  }
}
