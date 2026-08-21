import { getSupabaseAdmin } from './supabaseAdmin'

/**
 * Authorization: Bearer <supabase access token> を検証し、ユーザーIDを返す。
 *
 * これがないと、URLを知っている誰でも AI 生成（Anthropicの課金）や
 * 予約投稿（Xの課金＋本人になりすました投稿）を実行できてしまう。
 */
export async function requireUserId(authorizationHeader: string | undefined): Promise<string> {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new UnauthorizedError('ログインが必要です')

  const { data, error } = await getSupabaseAdmin().auth.getUser(token)
  if (error || !data.user) throw new UnauthorizedError('セッションが無効です。ログインし直してください')
  return data.user.id
}

export class UnauthorizedError extends Error {}

/** pg_cron から呼ばれる内部エンドポイント用の共有シークレット検証。 */
export function requireCronSecret(headerValue: string | undefined): void {
  const expected = process.env.CRON_SECRET
  if (!expected) throw new Error('CRON_SECRET が設定されていません')
  if (headerValue !== expected) throw new UnauthorizedError('invalid cron secret')
}
