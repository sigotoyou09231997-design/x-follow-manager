import type { VercelRequest, VercelResponse } from '@vercel/node'
// web-push は CommonJS なので、名前付きimportはNodeのESM規則では解決できない
// （`Named export 'sendNotification' not found` で落ちる）。default で受けて使う。
// api/配下の相対importに .js を付けるのと同じく、Vercel上でだけ出る種類の失敗。
import webpush from 'web-push'
import { requireCronSecret, UnauthorizedError } from './_lib/auth.js'
import { getSupabaseAdmin } from './_lib/supabaseAdmin.js'
import {
  buildUpdateNotificationPayload,
  shouldNotifyUpdate,
  VERSION_STATE_ID,
} from '../src/lib/appUpdate.js'

// Supabase の pg_cron から数分おきに呼ばれ、本番サイト自身の /version.json を見て
// 新しいデプロイに入れ替わっていれば、購読中の端末へプッシュ通知を送る。
//
// 画面内の更新バナー（src/main.tsx + UpdateBanner.tsx）はタブを開いている間しか
// 効かない。アプリを閉じていても更新に気づけるようにするのがこちらの役目。

interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth_key: string
}

function vapidConfig(): { publicKey: string; privateKey: string; subject: string } | undefined {
  // 環境変数へ貼るときに改行や空白が混ざりやすいのは他のキーと同じなので、ここでもtrimする。
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim()
  if (!publicKey || !privateKey || !subject) return undefined
  return { publicKey, privateKey, subject }
}

/**
 * 自分自身のURL。pg_cron は本番URLを直接叩くので、リクエストのホストがそのまま使える
 * （環境変数を1つ増やさずに済む）。SITE_URL があればそちらを優先する。
 */
function siteUrlFrom(req: VercelRequest): string | undefined {
  const configured = process.env.SITE_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host
  if (!host) return undefined
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https'
  return `${proto}://${host}`
}

/**
 * 公開中のビルドのバージョンを読む。CDNが古い版を返しても「気づくのが遅れる」だけで
 * 誤検知にはならないが、遅れる意味もないのでクエリでキャッシュを外す。
 */
async function fetchDeployedVersion(siteUrl: string): Promise<string | undefined> {
  const response = await fetch(`${siteUrl}/version.json?t=${Date.now()}`)
  if (!response.ok) return undefined
  const data = (await response.json()) as { version?: string }
  return data.version
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    requireCronSecret(
      (req.headers['x-cron-secret'] as string | undefined) ??
        req.headers.authorization?.replace(/^Bearer\s+/i, '')
    )
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : 500
    return res.status(status).json({ error: (error as Error).message })
  }

  const vapid = vapidConfig()
  if (!vapid) {
    // 未設定なら何もしない。予約投稿など他の機能はこの設定なしでも動くので、
    // ここで500を出し続けてcronのログを埋めるより、明示的に「無効」と返す方がよい。
    return res.status(200).json({ ok: true, skipped: 'VAPIDが未設定です' })
  }

  const siteUrl = siteUrlFrom(req)
  if (!siteUrl) return res.status(500).json({ error: 'サイトのURLを特定できませんでした' })

  const db = getSupabaseAdmin()

  try {
    const deployedVersion = await fetchDeployedVersion(siteUrl)
    if (!deployedVersion) {
      return res.status(200).json({ ok: true, skipped: '/version.json を読めませんでした' })
    }

    const { data: state, error: stateError } = await db
      .from('app_version_state')
      .select('version')
      .eq('id', VERSION_STATE_ID)
      .maybeSingle()
    if (stateError) throw new Error(`バージョン記録の取得に失敗しました: ${stateError.message}`)

    const previousVersion = (state as { version: string } | null)?.version ?? null

    if (!shouldNotifyUpdate(previousVersion, deployedVersion)) {
      if (previousVersion === null) {
        await db
          .from('app_version_state')
          .upsert({ id: VERSION_STATE_ID, version: deployedVersion, updated_at: new Date().toISOString() })
        return res.status(200).json({ ok: true, recorded: deployedVersion, notified: 0 })
      }
      return res.status(200).json({ ok: true, unchanged: true, notified: 0 })
    }

    // 送信の成否に関わらず、先に記録を進める。ここで失敗して古い値が残ると、
    // 次回以降も同じ変化を検知し続けて同じ通知を何度も送ってしまう。
    const { error: checkpointError } = await db
      .from('app_version_state')
      .upsert({ id: VERSION_STATE_ID, version: deployedVersion, updated_at: new Date().toISOString() })
    if (checkpointError) {
      console.error('checkAppUpdate: バージョン記録の更新に失敗:', checkpointError.message)
    }

    const { data: subs, error: subsError } = await db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
    if (subsError) throw new Error(`購読情報の取得に失敗しました: ${subsError.message}`)

    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
    const payload = buildUpdateNotificationPayload()

    let notified = 0
    let removed = 0
    for (const sub of (subs ?? []) as PushSubscriptionRow[]) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        )
        notified += 1
      } catch (error) {
        // 404 / 410 は購読が切れている（ブラウザ側で解除された・アプリを消した）。
        // 残しておいても二度と届かないので消す。
        if (
          error instanceof webpush.WebPushError &&
          (error.statusCode === 404 || error.statusCode === 410)
        ) {
          await db.from('push_subscriptions').delete().eq('id', sub.id)
          removed += 1
        } else {
          console.error('checkAppUpdate: 送信に失敗:', error)
        }
      }
    }

    return res
      .status(200)
      .json({ ok: true, from: previousVersion, to: deployedVersion, notified, removed })
  } catch (error) {
    console.error('checkAppUpdate failed:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
