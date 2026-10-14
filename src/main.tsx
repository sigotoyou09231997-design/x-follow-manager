import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
// 見た目の上塗り（LIFE HUB に合わせた白＋青緑＋黒）。App.css のあとに読み込む必要があるので、App の import より後ろに置く。
// この1行を外せば、元の見た目（Apple 風）に戻る。
import './theme-teal.css'
import { markUpdateAvailable, setUpdateApplier } from './lib/pwaUpdate'

// 開きっぱなしのタブは、自分から更新を見に行かない限り古いビルドを掴んだままになる。
// 実際「デプロイしたのに画面が変わらない」状態になり、強制リロードが必要だった。
// 1分おきとタブに戻ったタイミングで registration.update() を叩き、新しいビルドを
// 見つけたら UpdateBanner.tsx が帯を出して最新版へ切り替える。
// registerType: 'prompt'（vite.config.ts）なので、見つけた更新は適用されずに待機する。
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    markUpdateAvailable()
  },
  onRegisteredSW(_swScriptUrl, registration) {
    if (!registration) return
    const checkForUpdate = () => void registration.update()
    setInterval(checkForUpdate, 60_000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
  },
})
setUpdateApplier(updateSW)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
