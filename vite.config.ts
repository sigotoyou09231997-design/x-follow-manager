/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

/**
 * デプロイごとに値が変わる dist/version.json を出力する。
 * api/checkAppUpdate.ts が本番サイトのこのファイルを定期的に読み、前回見た値と
 * 変わっていれば「アプリが更新された」とみなしてプッシュ通知を送る。
 * タブを開いている間だけ効く画面内の更新バナー（src/main.tsx）とは別に、
 * アプリを閉じていても更新に気づけるようにするための土台。
 */
function writeVersionFile(): Plugin {
  return {
    name: 'write-version-file',
    generateBundle() {
      const version =
        process.env.VERCEL_GIT_COMMIT_SHA || process.env.BUILD_ID || String(Date.now())
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    writeVersionFile(),
    react(),
    VitePWA({
      // 'autoUpdate' だと見ている画面が予告なく差し替わる。予約投稿の下書きを
      // 書いている最中にそれをやられると入力が消えるため、更新は待たせておき、
      // いつ適用するかは UpdateBanner.tsx 側で決める。
      registerType: 'prompt',
      // 自動で差し込まれる registerSW.js はページ読み込み時に1度しか更新を見に行かない。
      // 開きっぱなしのタブが古いビルドを掴んだままになるので、登録は src/main.tsx で
      // 自前で行い、定期的に registration.update() を叩く。
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      workbox: {
        // push / notificationclick の2イベントだけを、生成済みのService Workerへ
        // importScripts で足す。プリキャッシュ周りの仕組みには触らない。
        importScripts: ['push-sw.js'],
        // /api/* はサーバー関数。SPAのフォールバック(index.html)に化けさせない。
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'X フォロー整理ツール',
        short_name: 'Follow tidy',
        description: '非相互フォローの整理と、Xの予約投稿',
        lang: 'ja',
        theme_color: '#000000',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '#store': path.resolve(import.meta.dirname, 'src/db/db.ts'),
      '#accounts-hook': path.resolve(import.meta.dirname, 'src/hooks/useAccounts.ts'),
      '#csv': path.resolve(import.meta.dirname, 'src/lib/csv.ts'),
      '#schedule-view': path.resolve(import.meta.dirname, 'src/components/schedule/ScheduleView.tsx'),
      '#push-settings': path.resolve(import.meta.dirname, 'src/components/PushSettings.tsx'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // api/ 配下のサーバー関数もテスト対象にする（Vercel上でしか動かない部分ほど、
    // 手元で1度も実行されないまま本番に出やすいため）。
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'api/**/*.{test,spec}.ts'],
  },
})
