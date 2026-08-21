import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// service_role キーを使うサーバー専用クライアント。RLSを完全に無視するため、
// 絶対にブラウザへ渡してはいけない（Vercelの環境変数に置き、api/配下だけで使う）。
let cached: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません')
  }
  cached = createClient(url, serviceKey, { auth: { persistSession: false } })
  return cached
}
