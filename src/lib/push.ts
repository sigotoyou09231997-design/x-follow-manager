import { getSupabase, getVapidPublicKey, requireSupabase } from './supabase'

// アプリの更新をロック画面へ知らせるためのWeb Push購読。
// 送信側は api/checkAppUpdate.ts（Supabaseのpg_cronから定期実行）。

const TABLE = 'push_subscriptions'
const DEVICE_ID_KEY = 'x-follow-manager-device-id'

/** この端末を表すID。購読し直しても行が増えないようにするために持つ。 */
function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

/**
 * PushManager.subscribe は base64url 文字列ではなくバイト列を要求するので変換する。
 * `new Uint8Array(n)` + 代入で作るのは、`Uint8Array.from` だと型が ArrayBufferLike に
 * 広がって BufferSource として受け取ってもらえないため。
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** この端末・ブラウザがWeb Pushに対応しているか。 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** サーバー側でVAPIDが設定されているか（未設定なら通知機能自体を出さない）。 */
export async function isPushConfigured(): Promise<boolean> {
  await getSupabase()
  return !!getVapidPublicKey()
}

/** この端末がいま購読中か。 */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

/**
 * 通知を有効にする。
 * 購読情報（送信先URLと鍵）をSupabaseへ保存し、サーバーから送れるようにする。
 * ログインが要るのは、購読情報を本人の行としてRLSで守るため。
 */
export async function enablePush(): Promise<void> {
  if (!isPushSupported()) {
    throw new Error('この端末・ブラウザは通知に対応していません')
  }
  const client = await requireSupabase()
  const vapidPublicKey = getVapidPublicKey()
  if (!vapidPublicKey) {
    throw new Error('サーバー側で通知の設定（VAPID_PUBLIC_KEY）が済んでいません')
  }

  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('ログインしていません')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('通知が許可されませんでした。ブラウザの設定から許可してください')
  }

  const registration = await navigator.serviceWorker.ready
  // 既存の購読があればそれを使う。鍵が変わっている場合だけ取り直す。
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
  }

  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error('購読情報を取得できませんでした')
  }

  const { error } = await client.from(TABLE).upsert(
    {
      id: crypto.randomUUID(),
      user_id: user.id,
      device_id: getDeviceId(),
      endpoint: json.endpoint,
      p256dh,
      auth_key: auth,
      updated_at: new Date().toISOString(),
    },
    // 同じ端末で入れ直しても行が増えないよう、送信先URLで突き合わせる。
    { onConflict: 'endpoint' }
  )
  if (error) throw new Error(`通知の登録に失敗しました: ${error.message}`)
}

/** 通知を止める。購読を解除し、保存してある送信先も消す。 */
export async function disablePush(): Promise<void> {
  const subscription = await getPushSubscription()
  const endpoint = subscription?.endpoint
  await subscription?.unsubscribe()

  if (!endpoint) return
  const client = await getSupabase()
  if (!client) return
  const { error } = await client.from(TABLE).delete().eq('endpoint', endpoint)
  if (error) throw new Error(`通知の解除に失敗しました: ${error.message}`)
}
