import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import './App.css'
import { FileDropZone } from './components/FileDropZone'
import { ErrorBanner } from './components/ErrorBanner'
import { HistoryView } from './components/HistoryView'
import { FollowTidyView, type FilterKey } from './components/FollowTidyView'
import { SettingsView, type FeatureTarget } from './components/SettingsView'
import { SummaryBar } from './components/SummaryBar'
import { UpdateBanner } from './components/UpdateBanner'
import { QuickMenu } from './components/QuickMenu'
import { Icon } from './components/Icon'
import { X_CALLBACK_PATH } from './lib/schedule/constants'
import { useAccounts, useCurrentBatchKeys, useSummary } from '#accounts-hook'
import { parseArchiveFile } from './lib/archiveParser'
import { computeNonMutual } from './lib/nonMutual'
import {
  clearAllData,
  getNextBatchKeys,
  META_KEYS,
  replaceNonMutualAccounts,
  setAccountStatus,
  setMeta,
} from '#store'
import type { AccountRecord } from './lib/types'

// 予約投稿はSupabaseなど重い依存を持つ一方、非相互フォローの整理だけ使う場合には
// 一切不要なので、タブを開いたときに初めて読み込む。
const ScheduleView = lazy(() =>
  import('#schedule-view').then((module) => ({ default: module.ScheduleView }))
)

// 掲示板・Yay の自動投稿（Macで動く投稿役の文と状態）。サーバー前提なので、これも開いたときに読み込む。
// AutoPostHome はアプリを開いて最初に出る1画面、AutoPostView は文や設定を変える詳細（設定から開く）。
const AutoPostHome = lazy(() =>
  import('#autopost-view').then((module) => ({ default: module.AutoPostHome }))
)
const AutoPostView = lazy(() =>
  import('#autopost-view').then((module) => ({ default: module.AutoPostView }))
)

type Tab = 'home' | 'tidy' | 'protected' | 'history' | 'schedule' | 'autopost' | 'settings'

// 画面は「自動投稿の1画面（home）」が入口で、ほかの機能は設定から開く。
// 戻るボタンの行き先と、ヘッダーに出す画面名はここで決める。
const SCREEN: Record<Tab, { title: string; parent: Tab | null }> = {
  home: { title: '自動投稿', parent: null },
  settings: { title: '設定', parent: 'home' },
  autopost: { title: '自動投稿の文と設定', parent: 'settings' },
  schedule: { title: '予約投稿', parent: 'settings' },
  tidy: { title: 'フォロー整理', parent: 'settings' },
  protected: { title: '残すリスト', parent: 'settings' },
  history: { title: '履歴', parent: 'settings' },
}

function buildFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function App() {
  const accounts = useAccounts()
  const summary = useSummary(accounts)
  const batchKeys = useCurrentBatchKeys()

  // Xの認可画面から戻ってきた直後は、そのまま予約投稿を開く。
  // 「自動投稿が止まっているかもしれません」の通知から開いたとき（?open=autopost）も、再起動のボタンがある1画面（home）から始まる。
  const [tab, setTab] = useState<Tab>(() => (window.location.pathname === X_CALLBACK_PATH ? 'schedule' : 'home'))
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [batchSize, setBatchSize] = useState<number>(100)
  const [importing, setImporting] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState<string[]>([])
  const [detectedFiles, setDetectedFiles] = useState<string[]>([])
  const hasData = (summary?.total ?? 0) > 0
  const accountList = useMemo(() => accounts ?? [], [accounts])

  const batchAccounts = useMemo(() => {
    const byKey = new Map(accountList.map((a) => [a.key, a]))
    return batchKeys.map((key) => byKey.get(key)).filter((a): a is AccountRecord => !!a)
  }, [accountList, batchKeys])

  async function handleFile(file: File) {
    // 解析には時間がかかる。その間にユーザーが別の画面へ移っていたら、
    // 読み込み完了を理由に引き戻さない（自分で開いた画面が勝手に閉じるため）。
    const tabAtStart = tab
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
      setSelectedKey(null)
      setTab((current) => (current === tabAtStart ? 'tidy' : current))
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
    setSelectedKey(null)
    setTab('home')
    setWarnings([])
    setErrorMessage([])
    setDetectedFiles([])
  }

  // 一覧のツールバーから明示的に押したとき。いつでもバッチを取り直す。
  async function startNextBatch() {
    const keys = await getNextBatchKeys(batchSize)
    await setMeta(META_KEYS.currentBatchKeys, keys)
    setFilter('all')
    setTab('tidy')
    setSelectedKey(keys[0] ?? null)
  }

  function goto(next: Tab, nextFilter?: FilterKey) {
    setTab(next)
    setSelectedKey(null)
    if (nextFilter) setFilter(nextFilter)
  }

  // 画面が変わったら先頭から見せる（設定を下までスクロールしてから開いた画面が、途中から始まらないように）。
  useEffect(() => {
    window.scrollTo?.(0, 0)
  }, [tab])

  function openFeature(target: FeatureTarget) {
    goto(target, target === 'protected' ? 'protected' : undefined)
  }

  // ホームは未読込でも自分で読み込み導線を出すので、案内が要るのは
  // 「一覧を見に来たのに中身が無い」画面だけ。
  const needsArchive = !hasData && !importing && (tab === 'tidy' || tab === 'protected' || tab === 'history')

  const screen = SCREEN[tab]
  const parent = screen.parent

  return (
    <div className="app-shell" data-screen={tab}>
      <UpdateBanner />

      {/* 画面の下に付いてくるメニュー。どの画面からでも、各画面（設定・予約投稿・フォロー整理…）へ行ける。 */}
      <QuickMenu current={tab} onSelect={(target) => goto(target, target === 'protected' ? 'protected' : undefined)} />

      <header className="app-header">
        {parent ? (
          <button
            type="button"
            className="app-header__back"
            onClick={() => goto(parent)}
            aria-label={`${SCREEN[parent].title}へ戻る`}
          >
            <Icon name="chevron-left" size={22} />
            <span>{SCREEN[parent].title}</span>
          </button>
        ) : (
          <span className="app-header__logo">SNSアプリ</span>
        )}

        {parent && <span className="app-header__title">{screen.title}</span>}

        {tab === 'home' && (
          <button
            type="button"
            className="app-header__avatar"
            onClick={() => goto('settings')}
            aria-label="設定を開く"
          >
            <Icon name="settings" size={18} />
          </button>
        )}
      </header>

      <div className="app-body">
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

          {tab === 'home' && (
            <Suspense fallback={<p className="loading-indicator">読み込み中…</p>}>
              <AutoPostHome onOpenDetail={() => goto('autopost')} />
            </Suspense>
          )}

          {/* 予約投稿はアーカイブの読み込みと無関係に使えるので、hasDataで閉じない。 */}
          {tab === 'schedule' && (
            <Suspense fallback={<p className="loading-indicator">読み込み中…</p>}>
              <ScheduleView />
            </Suspense>
          )}

          {tab === 'autopost' && (
            <Suspense fallback={<p className="loading-indicator">読み込み中…</p>}>
              <AutoPostView />
            </Suspense>
          )}

          {tab === 'settings' && (
            <SettingsView
              onOpenFeature={openFeature}
              tidyCounts={hasData && summary ? { pending: summary.pending, protected: summary.protected } : undefined}
              onReimport={handleFile}
              onClearAll={handleClearAll}
              lastImportedAt={summary?.lastImportedAt}
              importing={importing}
            />
          )}

          {/* 一覧を見に来たのに中身が無いとき。ここで読み込みまで済ませられると
              「設定へ戻ってやり直す」手間が無くなる。 */}
          {needsArchive && (
            <div className="surface-card onboarding">
              <div className="onboarding__main">
                <h2 className="onboarding__title">まずアーカイブを読み込みます</h2>
                <p className="onboarding__hint">
                  Xからダウンロードしたアーカイブ（ZIP）を、そのまま読み込めます。
                </p>
                <FileDropZone onFile={handleFile} disabled={importing} />
              </div>

              {/* 取り方は本文に混ぜて書いてあったが、広い画面で点線の枠の横に大きな余白が残るので、
                  3手順として横に並べ直した（文の内容は同じ）。 */}
              <aside className="onboarding__steps">
                <h3 className="onboarding__steps-title">アーカイブの取り方</h3>
                <ol>
                  <li>Xの「設定とプライバシー」を開く</li>
                  <li>「アカウント → データのアーカイブをダウンロード」を押す</li>
                  <li>届いたZIPを、左の枠に放り込む</li>
                </ol>
                <p className="onboarding__steps-note">
                  非相互フォローの整理はこのブラウザ内だけで完結し、外部サーバーとは通信しません。
                </p>
              </aside>
            </div>
          )}

          {hasData && summary && (
            <>
              {tab === 'tidy' && (
                <section className="surface-card home-metrics" aria-label="フォローの数">
                  <header className="home-metrics__head">
                    <h2 className="home-section__title">フォローの数</h2>
                    {summary.lastImportedAt && (
                      <span className="home-metrics__stamp">
                        {new Date(summary.lastImportedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                        に読み込み
                      </span>
                    )}
                  </header>
                  <SummaryBar summary={summary} />
                </section>
              )}

              {(tab === 'tidy' || tab === 'protected') && (
                <FollowTidyView
                  accounts={accountList}
                  overline={tab === 'protected' ? 'キープ中' : '未確認'}
                  heading={
                    tab === 'protected'
                      ? `残す${summary.protected.toLocaleString()}人`
                      : `非相互フォロー${summary.total.toLocaleString()}人`
                  }
                  filter={tab === 'protected' ? 'protected' : filter}
                  onFilterChange={setFilter}
                  showFilters={tab !== 'protected'}
                  search={search}
                  onSearchChange={setSearch}
                  selectedKey={selectedKey}
                  onSelect={setSelectedKey}
                  batchAccounts={batchAccounts}
                  batchSize={batchSize}
                  onBatchSizeChange={setBatchSize}
                  onStartBatch={startNextBatch}
                  pendingTotal={summary.pending}
                  onOpenProfile={handleOpenProfile}
                  onMarkDone={handleMarkDone}
                  onToggleProtect={handleToggleProtect}
                />
              )}

              {tab === 'history' && <HistoryView accounts={accountList} />}
            </>
          )}

          <footer className="app-footer">
            Xアーカイブの解析はこのブラウザ内でのみ行われ、外部へ送信されません。予約投稿だけは、あなたが連携したXアカウントとサーバー経由で通信します。
          </footer>
        </main>
      </div>
    </div>
  )
}

export default App
