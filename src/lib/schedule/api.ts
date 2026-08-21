import { requireSupabase } from '../supabase'

// Vercel Functions（/api/*）の呼び出し。Supabaseのアクセストークンを必ず添えて、
// サーバー側で本人確認できるようにする。

async function authorizedFetch<T>(path: string, body: unknown): Promise<T> {
  const client = await requireSupabase()
  const {
    data: { session },
  } = await client.auth.getSession()
  if (!session) throw new Error('ログインしていません')

  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`サーバーから予期しない応答が返りました (${response.status})`)
  }
  if (!response.ok) {
    throw new Error((parsed as { error?: string }).error ?? `リクエストに失敗しました (${response.status})`)
  }
  return parsed as T
}

// ---------------------------------------------------------------
// AI生成
// ---------------------------------------------------------------

export interface GeneratedPost {
  segments: string[]
  note: string
}

export interface GenerateRequest {
  topic: string
  count: number
  mode: 'single' | 'thread'
  threadLength?: number
  tone?: string
  styleExamples?: string[]
  currentText?: string
  instructions?: string
}

export async function generatePosts(request: GenerateRequest): Promise<GeneratedPost[]> {
  const data = await authorizedFetch<{ posts: GeneratedPost[] }>('/api/generatePosts', request)
  return data.posts
}

// ---------------------------------------------------------------
// X連携（OAuth 2.0 PKCE）
// ---------------------------------------------------------------

const VERIFIER_KEY = 'x-oauth-code-verifier'
const STATE_KEY = 'x-oauth-state'

/** XのリダイレクトURI。Xアプリの設定にこの値をそのまま登録する必要がある。 */
export function xRedirectUri(): string {
  return `${window.location.origin}/x-callback`
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const random = new Uint8Array(32)
  crypto.getRandomValues(random)
  const verifier = base64UrlEncode(random)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) }
}

/** Xの認可画面へ遷移する。 */
export async function startXConnect(): Promise<void> {
  const { clientId, scopes } = await authorizedFetch<{ clientId: string; scopes: string[] }>(
    '/api/xAuth',
    { action: 'config' }
  )
  const { verifier, challenge } = await createPkcePair()
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))

  // 認可後に戻ってきたとき検証するため、この端末に一時保存する。
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: xRedirectUri(),
    scope: scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  window.location.href = `https://x.com/i/oauth2/authorize?${params.toString()}`
}

/** /x-callback に戻ってきたときの処理。成功したら連携済みのusernameを返す。 */
export async function completeXConnect(code: string, state: string): Promise<string> {
  const savedState = sessionStorage.getItem(STATE_KEY)
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)

  if (!verifier) throw new Error('連携の途中経過が失われました。もう一度お試しください')
  // stateが一致しない＝別のサイトから誘導された可能性があるので中断する。
  if (!savedState || savedState !== state) throw new Error('連携リクエストの検証に失敗しました')

  const data = await authorizedFetch<{ username: string }>('/api/xAuth', {
    action: 'exchange',
    code,
    codeVerifier: verifier,
    redirectUri: xRedirectUri(),
  })
  return data.username
}

export async function disconnectX(): Promise<void> {
  await authorizedFetch('/api/xAuth', { action: 'disconnect' })
}
