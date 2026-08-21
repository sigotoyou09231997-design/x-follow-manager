import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// 予約投稿機能だけがSupabaseを使う。アーカイブ解析（非相互フォロー整理）は
// これまで通り完全にブラウザ内で完結し、外部へは何も送らない。
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** 環境変数が未設定なら null。予約投稿タブだけが無効になり、既存機能は動き続ける。 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabaseが設定されていません。VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定してください。'
    )
  }
  return supabase
}

export const isSupabaseConfigured = supabase !== null
