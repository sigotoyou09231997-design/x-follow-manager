import { requireSupabase } from '../supabase'
import type { AutopilotSettings, AutopilotState } from './types'

// X の自動運転（/api/xAutopilot）とのやり取り。Supabase のアクセストークンを添えて、サーバー側で本人確認する。

/** サーバーが断った・失敗した。setup は「保存先の表（SQL 007）がまだ無い」の印。 */
export class XAutopilotError extends Error {
  readonly status: number
  readonly setup: boolean
  constructor(message: string, status: number, setup = false) {
    super(message)
    this.status = status
    this.setup = setup
  }
}

export interface ActionReply {
  state: AutopilotState
  /** 設定を保存したとき: 枠の決まり方が変わって、まだ出ていない予約を作り直したか。 */
  rebuilt?: boolean
  /** 履歴を読み込んだとき。 */
  result?: { fetched: number; added: number; total: number } | { created: number; generated: number; error?: string } | { canceled: number }
  /** 試し書き。text が null のときは、AIが書けなかった。problems は検査に落ちた理由。 */
  preview?: { text: string | null; problems: string[] }
  /** 予約の文章をAIに整えてもらったとき。text が null のときは、AIが作れなかった。 */
  revised?: { text: string | null; problems: string[] }
  /** 入れた言葉・文章から書いてもらったとき。text が null のときは、AIが作れなかった。 */
  composed?: { text: string | null; problems: string[] }
}

async function call(body?: Record<string, unknown>): Promise<ActionReply> {
  const client = await requireSupabase()
  const {
    data: { session },
  } = await client.auth.getSession()
  if (!session) throw new XAutopilotError('ログインしていません', 401)

  const response = await fetch('/api/xAutopilot', {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${session.access_token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await response.text()
  let data: { error?: string; setup?: boolean } & Partial<ActionReply>
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // 受け口が無い版（まだデプロイされていない）だと、SPA の HTML が返ってくる。
    throw new XAutopilotError(`サーバーから予期しない応答が返りました (${response.status})`, response.status)
  }
  if (!response.ok || !data.state) {
    throw new XAutopilotError(data.error ?? `リクエストに失敗しました (${response.status})`, response.status, data.setup === true)
  }
  return data as ActionReply
}

export const fetchAutopilot = () => call()
export const saveAutopilotSettings = (settings: Partial<AutopilotSettings>) => call({ action: 'saveSettings', settings })
/** full: 最初から読み直す。省略は、前回より新しい投稿だけ（読み取りは件数で課金されるので差分が安い）。 */
export const readAutopilotHistory = (options: { full?: boolean } = {}) => call({ action: 'readHistory', ...options })
export const buildAutopilotProfile = () => call({ action: 'buildProfile' })
export const previewAutopilotPost = () => call({ action: 'preview' })
/** 予約してある1本の文章を、AIが本人の文体に整える（保存はしない。直した案が返る）。 */
export const composeAutopilotPost = (material: string, previous?: string) => call({ action: 'compose', material, previous })
export const reviseAutopilotPost = (text: string, instruction?: string) => call({ action: 'revise', text, instruction })
export const startAutopilot = () => call({ action: 'enable' })
export const stopAutopilot = () => call({ action: 'disable' })
/** 空いた枠（「取り消す」で外した枠）を、いちばん近い時刻から1つ、別の文で作り直す。AIを1回呼ぶので数十秒かかる。 */
export const refillAutopilot = () => call({ action: 'refill' })
