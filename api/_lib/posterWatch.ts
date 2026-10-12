import type { SupabaseClient } from '@supabase/supabase-js'
// web-push は CommonJS なので default で受ける（名前付き import だと Vercel 上でだけ落ちる。checkAppUpdate.ts と同じ理由）
import webpush from 'web-push'
import { getSupabaseAdmin } from './supabaseAdmin.js'
import type { ChannelName, PosterStatus } from './autopostDoc.js'

// Mac の投稿役（ディスコード・Yay）が止まったことを、スマホへ通知する見張り。
//
// 画面（自動投稿タブ）には「Macから応答がありません」と出るが、アプリを開かないと気づけない。
// 2026-10-12 に Yay が3時間止まっていたのに気づけなかったため、毎分の実行（publishDue）の末尾から呼んで、
// 報告が途絶えたらロック画面へ知らせる。Mac は数分おきに報告してくる（poster-status）ので、
// 途絶え＝止まった・Mac が寝た・ネットが切れたのどれか。

/**
 * これだけ報告が無ければ「止まっている」と見なす分数。画面（src/lib/autopost/draft.ts の ALIVE_WITHIN_MINUTES）と
 * 同じ値にして、画面の「応答がありません」と通知が食い違わないようにする（posterWatch.test.ts が一致を確かめる）。
 * サーバーは tsconfig.api.json が ES2023 のみで、ブラウザ側の部品を import すると型検査が通らないので、値だけ写している。
 */
export const SILENT_AFTER_MINUTES = 20

/** これより古い報告は「もう使っていない」と見なして通知しない（やめた投稿先を、いつまでも知らせ続けないため）。 */
export const GIVE_UP_AFTER_MINUTES = 3 * 24 * 60

const CHANNEL_LABEL: Record<ChannelName, string> = { discord: 'ディスコード', yay: 'Yay' }

/** 見張りが見る、投稿先1つぶんの状態。 */
export interface WatchedChannel {
  userId: string
  channel: ChannelName
  status: PosterStatus | null
  /** 画面で「止める」にしているか。わざと止めているなら、報告が無くても通知しない。 */
  paused: boolean
}

/** 本番は Supabase、テストでは手元の入れ物に差し替える。 */
export interface PosterWatchDeps {
  listChannels(): Promise<WatchedChannel[]>
  /** 通知したことを status に残す（同じ止まりで毎分通知しないため）。報告が新しくなっていたら何もしない。 */
  markAlerted(userId: string, channel: ChannelName, seen: PosterStatus, alertedAt: string): Promise<void>
  /** その人の端末へ通知を送る。届けた端末の数を返す（登録が無い・送れなければ 0）。 */
  notify(userId: string, payload: string): Promise<number>
}

const minutesSince = (iso: string, nowMs: number): number => Math.floor((nowMs - new Date(iso).getTime()) / 60000)

function agoText(minutes: number): string {
  return minutes < 60 ? `${minutes}分` : `${Math.floor(minutes / 60)}時間${minutes % 60}分`
}

/** いま通知すべき投稿先。 */
export function pickSilent(rows: WatchedChannel[], nowMs: number): WatchedChannel[] {
  return rows.filter((row) => {
    const status = row.status
    if (!status) return false
    // 画面で止めている（表の印・投稿役自身の報告のどちらでも）あいだは、報告が無くても正常
    if (row.paused || status.paused === true) return false
    // 同じ止まりでは1回だけ。投稿役が報告し直すと status ごと入れ替わって、この印は消える
    if (status.alertedAt) return false
    const minutes = minutesSince(status.at, nowMs)
    return Number.isFinite(minutes) && minutes >= SILENT_AFTER_MINUTES && minutes < GIVE_UP_AFTER_MINUTES
  })
}

export function buildSilentPayload(rows: WatchedChannel[], nowMs: number): string {
  const lines = rows.map(
    (row) => `${CHANNEL_LABEL[row.channel]}：${agoText(minutesSince(row.status!.at, nowMs))}前から報告がありません`
  )
  return JSON.stringify({
    title: '自動投稿が止まっているかもしれません',
    body: `${lines.join('\n')}\nMac の状態を確認してください。`,
    // タップすると、再起動のボタンがある自動投稿タブが開く（App.tsx が ?open=autopost を見る）
    url: '/?open=autopost',
    // 同じ通知が積み上がらないようにまとめる
    tag: 'poster-silent',
  })
}

/**
 * 止まっている投稿先があれば、持ち主の端末へ通知する。1人につき1通（複数の投稿先が止まっていればまとめる）。
 * 届け先が無いとき（通知を有効にしていない・全部送れなかった）は「通知済み」にしない。次の分にもう一度試す。
 */
export async function watchPosters(
  deps: PosterWatchDeps,
  nowMs: number = Date.now()
): Promise<{ silent: number; notified: number }> {
  const silent = pickSilent(await deps.listChannels(), nowMs)
  const byUser = new Map<string, WatchedChannel[]>()
  for (const row of silent) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row])

  let notified = 0
  for (const [userId, rows] of byUser) {
    try {
      const sent = await deps.notify(userId, buildSilentPayload(rows, nowMs))
      if (sent === 0) continue
      notified += sent
      const alertedAt = new Date(nowMs).toISOString()
      for (const row of rows) await deps.markAlerted(userId, row.channel, row.status!, alertedAt)
    } catch (error) {
      // 1人の失敗で、ほかの人への通知を止めない
      console.error('posterWatch: 通知に失敗しました:', (error as Error).message)
    }
  }
  return { silent: silent.length, notified }
}

// ---- 本番の入れ物（Supabase と Web Push） ----

interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth_key: string
}

function vapidConfig(): { publicKey: string; privateKey: string; subject: string } | undefined {
  // 環境変数へ貼るときに改行や空白が混ざりやすいので trim する（checkAppUpdate.ts と同じ）
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim()
  if (!publicKey || !privateKey || !subject) return undefined
  return { publicKey, privateKey, subject }
}

/** 表が見つからないときのコード（PostgREST は PGRST205、直接の問い合わせは 42P01）。 */
const MISSING_TABLE_CODES = ['PGRST205', '42P01']

export function supabasePosterWatchDeps(client: SupabaseClient = getSupabaseAdmin()): PosterWatchDeps {
  return {
    async listChannels() {
      const { data, error } = await client
        .from('autopost_channels')
        .select('user_id, channel, status')
        .not('status', 'is', null)
        .returns<{ user_id: string; channel: ChannelName; status: PosterStatus | null }[]>()
      if (error) throw new Error(`autopost_channels の読み込みに失敗しました: ${error.message}`)

      // 止める機能の表（SQL 006）が無ければ、止めている人もいない。それ以外の失敗は投げる
      // （読めなかったのに「止めていない」と扱うと、止めているのに通知してしまう）
      const pauses = await client.from('autopost_pause').select('user_id, channel').eq('paused', true)
      if (pauses.error && !MISSING_TABLE_CODES.includes(pauses.error.code ?? '')) {
        throw new Error(`autopost_pause の読み込みに失敗しました: ${pauses.error.message}`)
      }
      const paused = new Set((pauses.data ?? []).map((p) => `${p.user_id}/${p.channel}`))

      return (data ?? []).map((row) => ({
        userId: row.user_id,
        channel: row.channel,
        status: row.status,
        paused: paused.has(`${row.user_id}/${row.channel}`),
      }))
    },

    async markAlerted(userId, channel, seen, alertedAt) {
      // 読んだときの報告時刻のままのときだけ書く。間に投稿役が報告し直していたら、その新しい status を上書きしない
      const { error } = await client
        .from('autopost_channels')
        .update({ status: { ...seen, alertedAt } })
        .eq('user_id', userId)
        .eq('channel', channel)
        .eq('status->>at', seen.at)
      if (error) throw new Error(`通知済みの印を書けませんでした: ${error.message}`)
    },

    async notify(userId, payload) {
      const vapid = vapidConfig()
      if (!vapid) return 0
      const { data, error } = await client
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth_key')
        .eq('user_id', userId)
      if (error) throw new Error(`購読情報の取得に失敗しました: ${error.message}`)

      webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
      let sent = 0
      for (const sub of (data ?? []) as PushSubscriptionRow[]) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload)
          sent += 1
        } catch (err) {
          // 404 / 410 は購読が切れている。残しても二度と届かないので消す
          if (err instanceof webpush.WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
            await client.from('push_subscriptions').delete().eq('id', sub.id)
          } else {
            console.error('posterWatch: 通知の送信に失敗しました:', (err as Error).message)
          }
        }
      }
      return sent
    },
  }
}
