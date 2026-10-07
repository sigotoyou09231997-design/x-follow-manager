import { requireSupabase } from '../supabase'

// 掲示板・Yay の自動投稿（Mac で動く投稿役）の文と状態を、サーバー（/api/autopost）と
// やり取りする。Supabase のアクセストークンを添えて、サーバー側で本人確認する。

export type ChannelName = 'discord' | 'yay'

export const CHANNEL_NAMES: ChannelName[] = ['discord', 'yay']

export interface PosterStatus {
  lastPost: { t: string; text: string } | null
  today: number
  /** サーバーが報告を受け取った時刻。 */
  at: string
}

export interface ChannelSnapshot {
  channel: ChannelName
  messages: string[]
  /** 差し替えで外れた前の文。新しいものが先。 */
  archive: string[]
  /** 文を保存するたびに +1。別の端末で先に保存されたかどうかの目印。 */
  version: number
  savedAt: string | null
  status: PosterStatus | null
  limits: { maxLength: number; maxMessages: number }
}

export type Snapshots = Record<ChannelName, ChannelSnapshot>

/** 保存が別の端末と取り合いになった。最新の中身を添えて知らせる。 */
export class SaveConflictError extends Error {
  readonly snapshot: ChannelSnapshot
  constructor(message: string, snapshot: ChannelSnapshot) {
    super(message)
    this.snapshot = snapshot
  }
}

async function call<T>(method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; data: T }> {
  const client = await requireSupabase()
  const {
    data: { session },
  } = await client.auth.getSession()
  if (!session) throw new Error('ログインしていません')

  const response = await fetch('/api/autopost', {
    method,
    headers: {
      authorization: `Bearer ${session.access_token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const text = await response.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // 受け口が無い版（まだデプロイされていない）だと、SPA の HTML が返ってくる。
    throw new Error(`サーバーから予期しない応答が返りました (${response.status})`)
  }
  return { status: response.status, data: data as T }
}

function failureMessage(status: number, data: unknown): string {
  return (data as { error?: string }).error ?? `リクエストに失敗しました (${status})`
}

export async function fetchSnapshots(): Promise<Snapshots> {
  const { status, data } = await call<{ channels: Snapshots }>('GET')
  if (status < 200 || status >= 300) throw new Error(failureMessage(status, data))
  return data.channels
}

export async function saveMessages(
  channel: ChannelName,
  messages: string[],
  baseVersion: number
): Promise<ChannelSnapshot> {
  const { status, data } = await call<{ snapshot: ChannelSnapshot; error?: string }>('POST', {
    channel,
    messages,
    baseVersion,
  })
  if (status === 409) throw new SaveConflictError(failureMessage(status, data), data.snapshot)
  if (status < 200 || status >= 300) throw new Error(failureMessage(status, data))
  return data.snapshot
}
