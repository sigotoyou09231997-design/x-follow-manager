import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUserId, UnauthorizedError } from './_lib/auth.js'
import { getSupabaseAdmin } from './_lib/supabaseAdmin.js'
import { exchangeAuthorizationCode, fetchMe, X_SCOPES } from './_lib/xClient.js'

// XのOAuth 2.0(PKCE)のうち、クライアントシークレットを使う部分と
// トークンの保管をサーバー側で行う。ブラウザにはトークンを一切渡さない。

type Body =
  | { action: 'config' }
  | { action: 'exchange'; code: string; codeVerifier: string; redirectUri: string }
  | { action: 'disconnect' }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let userId: string
  try {
    userId = await requireUserId(req.headers.authorization)
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : 500
    return res.status(status).json({ error: (error as Error).message })
  }

  let payload: Body
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  } catch {
    return res.status(400).json({ error: 'リクエストの形式が不正です' })
  }

  try {
    if (payload.action === 'config') {
      // 認可URLの組み立てはブラウザ側で行うため、公開して問題ない client_id だけ返す。
      const clientId = process.env.X_CLIENT_ID
      if (!clientId) return res.status(500).json({ error: 'X_CLIENT_ID が設定されていません' })
      return res.status(200).json({ clientId, scopes: X_SCOPES })
    }

    if (payload.action === 'exchange') {
      if (!payload.code || !payload.codeVerifier || !payload.redirectUri) {
        return res.status(400).json({ error: 'code / codeVerifier / redirectUri が必要です' })
      }
      const tokens = await exchangeAuthorizationCode(
        payload.code,
        payload.codeVerifier,
        payload.redirectUri
      )
      const me = await fetchMe(tokens.accessToken)

      const { error } = await getSupabaseAdmin().from('x_accounts').upsert(
        {
          user_id: userId,
          x_user_id: me.id,
          username: me.username,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_at: tokens.expiresAt,
          scope: tokens.scope,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      if (error) return res.status(500).json({ error: `保存に失敗しました: ${error.message}` })

      return res.status(200).json({ username: me.username, xUserId: me.id })
    }

    if (payload.action === 'disconnect') {
      const { error } = await getSupabaseAdmin().from('x_accounts').delete().eq('user_id', userId)
      if (error) return res.status(500).json({ error: `解除に失敗しました: ${error.message}` })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: '不明な action です' })
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message })
  }
}
