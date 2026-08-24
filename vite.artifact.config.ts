import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'

// Claude Artifact用のビルド設定。
// db.ts(Dexie)の代わりにartifactStore.ts(publish()ベースの同期)を使い、
// 予約投稿はスタブに差し替えたうえで、JS/CSSを1つのHTMLファイルへinlineする。
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '#store': path.resolve(import.meta.dirname, 'src/artifact/artifactStore.ts'),
      '#accounts-hook': path.resolve(import.meta.dirname, 'src/artifact/useArtifactAccounts.ts'),
      '#csv': path.resolve(import.meta.dirname, 'src/artifact/downloadCsv.ts'),
      // 予約投稿はサーバー前提の機能なので、Artifact版では案内だけのスタブに差し替える。
      '#schedule-view': path.resolve(import.meta.dirname, 'src/artifact/ScheduleViewStub.tsx'),
      // 通知もサーバー(とデプロイ)前提なので、Supabaseごと連れてこないよう空に差し替える。
      '#push-settings': path.resolve(import.meta.dirname, 'src/artifact/PushSettingsStub.tsx'),
    },
  },
  build: {
    outDir: 'dist-artifact',
    rollupOptions: {
      input: path.resolve(import.meta.dirname, 'index.artifact.html'),
    },
    cssCodeSplit: false,
    assetsInlineLimit: Infinity,
  },
})
