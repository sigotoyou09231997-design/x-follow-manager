import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

// 投稿文をAIに書かせる部分。画面から呼ばれる generatePosts と、
// 毎日の自動投稿を作る publishDue の両方がここを通る。
//
// 文章のルールを片方にだけ書くと、画面から作った投稿と自動で作られた投稿とで
// 字数上限やURLの扱いが食い違い、自動投稿だけが投稿時に失敗する（しかも
// 誰も見ていない時間に失敗する）。そうならないよう、ルールは1か所に置く。

export const MODEL = 'claude-opus-5'

export const GeneratedPostsSchema = z.object({
  posts: z.array(
    z.object({
      // スレッド(連投)は複数要素。単発投稿は1要素。
      segments: z.array(z.string()),
      // どういう切り口の案か（画面で案を選ぶときの手がかり）
      note: z.string(),
    })
  ),
})

export interface GeneratedPost {
  segments: string[]
  note: string
}

/** 投稿文そのものの決まりごと。生成の入口が増えてもここを共有する。 */
export const WRITING_RULES = `文章のルール:
- 1つのsegmentは全角140字/半角280字以内に必ず収める。これはXの投稿上限であり、超えると投稿が失敗する
- ハッシュタグは、明示的に求められた場合のみ付ける。頼まれていないのに付けない
- URLを含めない。ユーザーが書いた場合のみ含める(X APIはURL入り投稿の課金が13倍になるため)
- 「いかがでしたか」「〜と思いませんか？」のような中身のない締めや、AIが書いたと一目で分かる定型文を使わない
- 各案は切り口を実際に変える。語尾や言い回しを入れ替えただけの案を並べない
- 「過去の投稿例」が渡された場合、そこから語調・一人称・文の長さ・絵文字の使い方を読み取り、同じ書き手が書いたと感じられる文章にする。ただし例文の内容そのものは流用しない`

// 環境変数へ貼り付ける際に改行や前後の空白が紛れ込みやすい。混入したままだと
// Anthropicには別の文字列として送られ、401（APIキーが無効）で返ってくる。
// X_CLIENT_ID / X_CLIENT_SECRET で同じ問題があったため、同様にtrimする。
export function anthropicApiKey(): string | undefined {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  return key || undefined
}

/** 401時の切り分け用。値そのものは絶対に出さず、形だけを返す。 */
export function apiKeyShape(): string {
  const raw = process.env.ANTHROPIC_API_KEY ?? ''
  const key = raw.trim()
  const parts = [`${key.length}文字`]
  if (raw !== key) parts.push('前後に余分な空白/改行あり')
  if (/^["']|["']$/.test(key)) parts.push('引用符が含まれている')
  if (key.startsWith('sk-ant-admin')) parts.push('Admin key（メッセージ送信には使えません）')
  else if (key.startsWith('sk-ant-')) parts.push('接頭辞は sk-ant- で正しい')
  else parts.push('接頭辞が sk-ant- ではない')
  // コンソールは既存の鍵を sk-ant-api03-xuP...IQAA のように省略表示する。
  // これをコピーすると省略記号がそのまま値になり、23文字前後で保存される。
  if (key.includes('...') || key.includes('…')) {
    parts.push(
      'マスク表示をコピーしています → 「...」は省略記号で、実際の鍵ではありません。' +
        '鍵の全文は新規作成した直後の画面でしか表示されません'
    )
  } else if (key.length > 0 && key.length < 60) {
    // 正規の鍵は sk-ant-api03- + 約95文字で100文字を超える。
    parts.push('短すぎる → 値が途中で切れています。鍵を新規発行して全文を貼り直してください')
  }
  return parts.join(', ')
}

export class RefusedError extends Error {}

export interface WritePostsInput {
  apiKey: string
  system: string
  user: string
  /** 費用の大半は思考トークン。深い推論を要さない用途は 'low' で足りる。 */
  effort?: 'low' | 'medium' | 'high'
  /** 応答が返らないまま関数の実行時間を食い尽くさないための上限(ミリ秒)。 */
  timeoutMs?: number
}

/**
 * Anthropicに投稿案を書かせる。
 * 呼び出し側で扱いを変えたいものだけ例外の型を分け、それ以外はそのまま投げる。
 */
export async function writePosts(input: WritePostsInput): Promise<GeneratedPost[]> {
  const client = new Anthropic({ apiKey: input.apiKey })
  const response = await client.messages.parse(
    {
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
      output_config: {
        effort: input.effort ?? 'medium',
        format: zodOutputFormat(GeneratedPostsSchema),
      },
    },
    input.timeoutMs ? { timeout: input.timeoutMs } : undefined
  )

  if (response.stop_reason === 'refusal') {
    throw new RefusedError('この内容では投稿文を生成できませんでした')
  }
  return response.parsed_output?.posts ?? []
}
