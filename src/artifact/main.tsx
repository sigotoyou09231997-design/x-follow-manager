import { createRoot } from 'react-dom/client'
import '../index.css'
import App from '../App.tsx'

function showFatalError(err: unknown): void {
  console.error('x-follow-manager: failed to start', err)
  const rootEl = document.getElementById('root')
  if (!rootEl) return
  const message = err instanceof Error ? err.message : String(err)
  rootEl.innerHTML =
    '<div style="padding:24px;font:14px/1.5 system-ui,sans-serif;color:#3f3f46;max-width:480px;margin:0 auto">' +
    '<h1 style="font-size:16px;margin:0 0 8px">読み込みに失敗しました</h1>' +
    '<p style="margin:0 0 12px;color:#71717a">ページの再読み込みをお試しください。改善しない場合は下記のエラー内容を教えてください。</p>' +
    '<pre style="white-space:pre-wrap;font-size:12px;background:#f4f4f5;padding:8px;border-radius:6px">' +
    message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string) +
    '</pre></div>'
}

try {
  const rootEl = document.getElementById('root')
  if (rootEl) {
    createRoot(rootEl).render(<App />)
  }
} catch (err) {
  showFatalError(err)
}
