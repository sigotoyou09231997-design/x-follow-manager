import { lazy, Suspense, useState } from 'react'
import './App.css'
import { FileDropZone } from './components/FileDropZone'
import { ErrorBanner } from './components/ErrorBanner'
import { SummaryBar } from './components/SummaryBar'
import { AccountListView } from './components/AccountListView'
import { BatchWorkView } from './components/BatchWorkView'
import { SettingsView } from './components/SettingsView'
import { X_CALLBACK_PATH } from './lib/schedule/constants'
import { useAccounts, useSummary } from '#accounts-hook'
import { parseArchiveFile } from './lib/archiveParser'
import { computeNonMutual } from './lib/nonMutual'
import { clearAllData, META_KEYS, replaceNonMutualAccounts, setAccountStatus, setMeta } from '#store'
import type { AccountRecord } from './lib/types'

// 予約投稿はSupabaseなど重い依存を持つ一方、非相互フォローの整理だけ使う場合には
// 一切不要なので、タブを開いたときに初めて読み込む。
const ScheduleView = lazy(() =>
  import('#schedule-view').then((module) => ({ default: module.ScheduleView }))
)

type Tab = 'list' | 'work' | 'schedule' | 'settings'

function buildFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function App() {
  const accounts = useAccounts()
  const summary = useSummary(accounts)

  // Xの認可画面から戻ってきた直後は、そのまま予約投稿タブを開く。
  const [tab, setTab] = useState<Tab>(() =>
    window.location.pathname === X_CALLBACK_PATH ? 'schedule' : 'list'
  )
  const [importing, setImporting] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState<string[]>([])
  const [detectedFiles, setDetectedFiles] = useState<string[]>([])

  const hasData = (summary?.total ?? 0) > 0

  async function handleFile(file: File) {
    setImporting(true)
    setErrorMessage([])
    setWarnings([])
    try {
      const parsed = await parseArchiveFile(file)
      setDetectedFiles(parsed.detectedFiles)

      const nonMutual = computeNonMutual(parsed.following, parsed.followers)
      await replaceNonMutualAccounts(nonMutual, buildFingerprint(file))
      await setMeta(META_KEYS.followingCount, parsed.following.length)
      await setMeta(META_KEYS.followersCount, parsed.followers.length)
      await setMeta(META_KEYS.currentBatchKeys, [])

      setWarnings(parsed.warnings)
      setTab('list')
    } catch (error) {
      setErrorMessage([
        'アーカイブZIPの読み込みに失敗しました。ファイルが破損していないか確認してください。',
        error instanceof Error ? error.message : String(error),
      ])
    } finally {
      setImporting(false)
    }
  }

  async function handleOpenProfile(account: AccountRecord) {
    // ステータス変更はしない。ユーザーがXで実際に解除操作を行った後、
    // 明示的に「解除済みにする」を押すまではローカル状態は変更しない。
    void account
  }

  async function handleMarkDone(account: AccountRecord) {
    await setAccountStatus(account.key, account.status === 'done' ? 'pending' : 'done')
  }

  async function handleToggleProtect(account: AccountRecord) {
    await setAccountStatus(account.key, account.status === 'protected' ? 'pending' : 'protected')
  }

  async function handleClearAll() {
    await clearAllData()
    setTab('list')
    setWarnings([])
    setErrorMessage([])
    setDetectedFiles([])
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>X 非相互フォロー整理ツール</h1>
        <p className="app-header__desc">
          Xアーカイブから「フォローしているのにフォローされていない」アカウントを全件抽出し、100人ずつ手元で整理できます。
        </p>
      </header>

      <main className="main-content">
        {errorMessage.length > 0 && (
          <ErrorBanner
            tone="error"
            title="読み込みエラー"
            messages={errorMessage}
            detectedFiles={detectedFiles}
            onDismiss={() => setErrorMessage([])}
          />
        )}
        {warnings.length > 0 && (
          <ErrorBanner
            tone="warning"
            title="読み込み時の警告"
            messages={warnings}
            detectedFiles={detectedFiles}
            onDismiss={() => setWarnings([])}
          />
        )}

        {importing && <p className="loading-indicator">アーカイブを解析しています…</p>}

        {hasData && summary && <SummaryBar summary={summary} />}

        <nav className="tab-nav">
          <button type="button" className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
            一覧
          </button>
          <button type="button" className={tab === 'work' ? 'active' : ''} onClick={() => setTab('work')}>
            作業モード
          </button>
          <button
            type="button"
            className={tab === 'schedule' ? 'active' : ''}
            onClick={() => setTab('schedule')}
          >
            予約投稿
          </button>
          <button
            type="button"
            className={tab === 'settings' ? 'active' : ''}
            onClick={() => setTab('settings')}
          >
            設定
          </button>
        </nav>

        {/* 予約投稿はアーカイブの読み込みと無関係に使えるので、hasDataで閉じない。 */}
        {tab === 'schedule' && (
          <Suspense fallback={<p className="loading-indicator">読み込み中…</p>}>
            <ScheduleView />
          </Suspense>
        )}

        {tab !== 'schedule' && !hasData && !importing && (
          <div className="onboarding">
            <FileDropZone onFile={handleFile} disabled={importing} />
            <p className="onboarding__hint">
              Xの「設定とプライバシー → アカウント → データのアーカイブをダウンロード」から取得したZIPファイルをそのまま読み込めます。
              非相互フォローの整理はこのブラウザ内だけで完結し、外部サーバーとは通信しません。
            </p>
          </div>
        )}

        {hasData && summary && (
          <>
            {tab === 'list' && (
              <AccountListView
                accounts={accounts ?? []}
                onOpenProfile={handleOpenProfile}
                onMarkDone={handleMarkDone}
                onToggleProtect={handleToggleProtect}
              />
            )}
            {tab === 'work' && (
              <BatchWorkView
                accounts={accounts ?? []}
                onOpenProfile={handleOpenProfile}
                onMarkDone={handleMarkDone}
                onToggleProtect={handleToggleProtect}
              />
            )}
            {tab === 'settings' && (
              <SettingsView
                onReimport={handleFile}
                onClearAll={handleClearAll}
                lastImportedAt={summary.lastImportedAt}
                importing={importing}
              />
            )}
          </>
        )}

      </main>

      <footer className="app-footer">
        Xアーカイブの解析はこのブラウザ内でのみ行われ、外部へ送信されません。予約投稿だけは、あなたが連携したXアカウントとサーバー経由で通信します。
      </footer>
    </div>
  )
}

export default App
