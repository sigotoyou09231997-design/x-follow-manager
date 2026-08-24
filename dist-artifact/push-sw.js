// vite.config.ts の workbox.importScripts 経由で、生成済みのService Workerに
// importScripts() で読み込ませる素のJS。プリキャッシュや更新まわりの仕組みには触らず、
// push / notificationclick の2イベントだけを足す。
// ペイロードの形は api/checkAppUpdate.ts の buildUpdateNotificationPayload と対になる
// （title / body / url）。

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || 'X フォロー整理ツール'
  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    // 同じ内容の通知が積み上がらないようにまとめる。
    tag: data.tag || 'app-update',
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
      return undefined
    })
  )
})
