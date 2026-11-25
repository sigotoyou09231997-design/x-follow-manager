import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUserId, UnauthorizedError } from './_lib/auth.js'
import { getSupabaseAdmin } from './_lib/supabaseAdmin.js'
import { exchangeAuthorizationCode, fetchMe, X_SCOPES } from './_lib/xClient.js'

// XのOAuth 2.0(PKCE)のうち、クライアントシークレットを使う部分と
// トークンの保管をサーバー側で行う。ブラウザにはトークンを一切渡さない。

/**
 * どの連携か。main は本アカウント（予約投稿・自動運転。x_accounts）、xrepeat は X（くり返し）が投稿するアカウント
 * （x_repeat_accounts）。2026-11-25、X（くり返し）が本アカウントに投稿してしまったので分けた。無ければ main。
 */
type Purpose = 'main' | 'xrepeat'

type Body =
  | { action: 'config' }
  | { action: 'exchange'; code: string; codeVerifier: string; redirectUri: string; purpose?: Purpose }
  | { action: 'disconnect'; purpose?: Purpose }

const TABLE: Record<Purpose, 'x_accounts' | 'x_repeat_accounts'> = { main: 'x_accounts', xrepeat: 'x_repeat_accounts' }

function purposeOf(value: unknown): Purpose | null {
  if (value === undefined) return 'main'
  return value === 'main' || value === 'xrepeat' ? value : null
}

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
      const purpose = purposeOf(payload.purpose)
      if (!purpose) return res.status(400).json({ error: '連携の種類が正しくありません' })
      const tokens = await exchangeAuthorizationCode(
        payload.code,
        payload.codeVerifier,
        payload.redirectUri
      )
      const me = await fetchMe(tokens.accessToken)

      if (purpose === 'xrepeat') {
        // 本アカウントと同じアカウントは、X（くり返し）の投稿先にしない（本アカウントに同じ文が1時間おきに出てしまう）。
        // X の許可画面は、ブラウザでいま入っているアカウントのまま進みやすいので、取り違えをここで止める
        const { data: main } = await getSupabaseAdmin()
          .from('x_accounts')
          .select('x_user_id, username')
          .eq('user_id', userId)
          .maybeSingle<{ x_user_id: string; username: string }>()
        if (main && main.x_user_id === me.id) {
          return res.status(400).json({
            error: `@${me.username} は本アカウントです。X で投稿したいアカウントに切り替えてから、もう一度連携してください`,
          })
        }
      }

      const { error } = await getSupabaseAdmin().from(TABLE[purpose]).upsert(
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

      return res.status(200).json({ username: me.username, xUserId: me.id, purpose })
    }

    if (payload.action === 'disconnect') {
      const purpose = purposeOf(payload.purpose)
      if (!purpose) return res.status(400).json({ error: '連携の種類が正しくありません' })
      const { error } = await getSupabaseAdmin().from(TABLE[purpose]).delete().eq('user_id', userId)
      if (error) return res.status(500).json({ error: `解除に失敗しました: ${error.message}` })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: '不明な action です' })
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message })
  }
}
