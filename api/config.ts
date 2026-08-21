import type { VercelRequest, VercelResponse } from '@vercel/node'

// ブラウザが起動時に読む公開設定。
//
// なぜビルド時埋め込み(VITE_)をやめたか:
// Vercelでは「Sensitive」に設定した変数がビルド時に渡されず、
// ビルドキャッシュの影響も受けるため、環境変数を正しく設定しても
// 値が黙って欠落することがある。画面上は「未設定」と出るだけで原因が分からない。
// 実行時にここから配れば、環境変数を直した瞬間に反映される（再デプロイ不要）。
//
// ここで返すのは公開前提の2つだけ。anon key はブラウザに露出する設計で、
// 実際のアクセス制御は Supabase の RLS が行う。
// service_role key / Xのシークレット / Anthropicキーは絶対に返さない。
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

  // 設定漏れの切り分け用。値は返さず、設定済みかどうかだけを返す。
  const configured = {
    supabaseUrl: !!supabaseUrl,
    supabaseAnonKey: !!supabaseAnonKey,
    serviceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    anthropicApiKey: !!process.env.ANTHROPIC_API_KEY,
    xClientId: !!process.env.X_CLIENT_ID,
    xClientSecret: !!process.env.X_CLIENT_SECRET,
    cronSecret: !!process.env.CRON_SECRET,
  }

  // 環境変数を直したらすぐ反映されてほしいのでキャッシュさせない。
  res.setHeader('cache-control', 'no-store')
  return res.status(200).json({ supabaseUrl, supabaseAnonKey, configured })
}
