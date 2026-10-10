import { getSupabaseAdmin } from './supabaseAdmin.js'
import { refreshAccessToken, XApiError } from './xClient.js'

// 連携済みの X アカウントのアクセストークンを、有効なものにして返す。
// 予約の実行（publishDue）と、自動運転の履歴の読み取り（autopilot）の両方が使う。

interface XAccountRow {
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
}

/** 期限が近ければ更新しつつ、有効なアクセストークンを返す。cache は同じ実行の中で同じ人のトークンを何度も更新しないため。 */
export async function getAccessToken(userId: string, cache?: Map<string, string>): Promise<string> {
  const cached = cache?.get(userId)
  if (cached) return cached

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('x_accounts')
    .select('user_id, access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`X連携情報の取得に失敗しました: ${error.message}`)
  if (!data) throw new XApiError('Xアカウントが連携されていません', 400, false)

  const account = data as XAccountRow
  // 失効の5分前から更新する。投稿の途中で切れるより早めに更新した方が安全。
  const expiresSoon = new Date(account.expires_at).getTime() - Date.now() < 5 * 60_000
  if (!expiresSoon) {
    cache?.set(userId, account.access_token)
    return account.access_token
  }

  // X のリフレッシュトークンは使い捨てで、更新のたびに新しいものが返る。
  // 保存に失敗すると次回以降ずっと更新できなくなるため、必ず書き戻す。
  const tokens = await refreshAccessToken(account.refresh_token)
  const { error: saveError } = await db
    .from('x_accounts')
    .update({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
  if (saveError) throw new Error(`トークンの保存に失敗しました: ${saveError.message}`)

  cache?.set(userId, tokens.accessToken)
  return tokens.accessToken
}
