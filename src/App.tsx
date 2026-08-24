import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import './App.css'
import { FileDropZone } from './components/FileDropZone'
import { ErrorBanner } from './components/ErrorBanner'
import { HomeView } from './components/HomeView'
import { HistoryView } from './components/HistoryView'
import { FollowTidyView, type FilterKey } from './components/FollowTidyView'
import { SettingsView } from './components/SettingsView'
import { UpdateBanner } from './components/UpdateBanner'
import { Icon, type IconName } from './components/Icon'
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

type Tab = 'home' | 'tidy' | 'protected' | 'history' | 'schedule' | 'settings'

// モバイル下部バー。中央の＋（FAB）はナビ項目ではなく操作なので、この配列には含めない。
const BOTTOM_NAV: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'ホーム', icon: 'home' },
  { id: 'tidy', label: 'フォロー整理', icon: 'tasks' },
  { id: 'schedule', label: '予約投稿', icon: 'calendar' },
  { id: 'settings', label: '設定', icon: 'settings' },
]

// PC左サイドバー。
const SIDE_NAV: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'tidy', label: 'フォロー整理', icon: 'tasks' },
  { id: 'protected', label: '残すリスト', icon: 'bookmark' },
  { id: 'history', label: '履歴', icon: 'history' },
  { id: 'schedule', label: '予約投稿', icon: 'calendar' },
  { id: 'settings', label: '設定', icon: 'settings' },
]

function buildFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function App() {
  const accounts = useAccounts()
  const summary = useSummary(accounts)
  const batchKeys = useCurrentBatchKeys()

  // Xの認可画面から戻ってきた直後は、そのまま予約投稿タブを開く。
  const [tab, setTab] = useState<Tab>(() =>
    window.location.pathname === X_CALLBACK_PATH ? 'schedule' : 'home'
  )
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [batchSize, setBatchSize] = useState<number>(100)
  const [importing, setImporting] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState<string[]>([])
  const [detectedFiles, setDetectedFiles] = useState<string[]>([])
  // 中央の＋を押した回数。ScheduleViewはこれが増えたらコンポーザーを開く。
  const [composeRequest, setComposeRequest] = useState(0)

  const headerSearchRef = useRef<HTMLInputElement>(null)
  const listSearchRef = useRef<HTMLInputElement>(null)

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
      setTab((current) => (current === tabAtStart ? 'home' : current))
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

  // FAB とサイドバーのCTA。「押しても何も起きない」を作らないための入口で、
  // 進行中のバッチがあれば再開し、未確認が無いときはその事実が分かる画面に送る。
  async function openNextReview() {
    const unfinished = batchAccounts.find((account) => account.status === 'pending')
    if (unfinished) {
      setFilter('all')
      setTab('tidy')
      setSelectedKey(unfinished.key)
      return
    }

    if ((summary?.pending ?? 0) === 0) {
      // 未確認0件。空の一覧を出して「すべて確認済み」だと分かるようにする。
      setFilter('pending')
      setTab('tidy')
      setSelectedKey(null)
      return
    }

    await startNextBatch()
  }

  // 中央の＋（FAB）。予約投稿の作成画面を直接開く。
  // フォロー整理の「次の◯人を確認」は、ホームの今日のタスクとフォロー整理の
  // ツールバーから始められるので、モバイルでも入口は失われない。
  function openCompose() {
    setTab('schedule')
    setComposeRequest((prev) => prev + 1)
  }

  // 「残すリスト」はフォロー整理の派生画面なので、下部バーでは同じ項目を現在地として扱う。
  function isCurrent(id: Tab): boolean {
    return id === tab || (id === 'tidy' && tab === 'protected')
  }

  function goto(next: Tab, nextFilter?: FilterKey) {
    setTab(next)
    setSelectedKey(null)
    if (nextFilter) setFilter(nextFilter)
  }

  // 画面幅によってヘッダー側かリスト側のどちらかしか出ていないので、見えている方に合わせる。
  function focusSearch() {
    setTab('tidy')
    requestAnimationFrame(() => {
      const target = [headerSearchRef.current, listSearchRef.current].find(
        (el) => el && el.offsetParent !== null
      )
      target?.focus()
    })
  }

  const needsArchive = !hasData && !importing && tab !== 'schedule' && tab !== 'settings'

  return (
    <div className="app-shell">
      <UpdateBanner />

      <header className="app-header">
        <button type="button" className="app-header__logo" onClick={() => goto('home')}>
          Follow tidy
        </button>

        <div className="app-header__search">
          <Icon name="search" size={16} />
          <input
            ref={headerSearchRef}
            type="search"
            placeholder="アカウントを検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => {
              if (tab !== 'tidy' && tab !== 'protected') setTab('tidy')
            }}
          />
        </div>

        <span className="privacy-badge">
          <Icon name="lock" size={14} />
          端末内で処理
        </span>

        <button
          type="button"
          className="app-header__avatar"
          onClick={() => goto('settings')}
          aria-label="設定を開く"
        >
          <Icon name="user" size={18} />
        </button>
      </header>

      <div className="app-body">
        <nav className="side-nav" aria-label="メインメニュー">
          {SIDE_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`side-nav__item${tab === item.id ? ' active' : ''}`}
              onClick={() => goto(item.id, item.id === 'protected' ? 'protected' : undefined)}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="btn btn--primary side-nav__cta"
            onClick={openNextReview}
          >
            <Icon name="plus" size={18} />
            次の{batchSize}人を確認
          </button>
        </nav>

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

          {/* 予約投稿はアーカイブの読み込みと無関係に使えるので、hasDataで閉じない。 */}
          {tab === 'schedule' && (
            <Suspense fallback={<p className="loading-indicator">読み込み中…</p>}>
              <ScheduleView composeRequest={composeRequest} />
            </Suspense>
          )}

          {tab === 'settings' && (
            <SettingsView
              onReimport={handleFile}
              onClearAll={handleClearAll}
              lastImportedAt={summary?.lastImportedAt}
              importing={importing}
            />
          )}

          {needsArchive && (
            <div className="onboarding">
              <h2 className="onboarding__title">気になる人だけ、残そう。</h2>
              <FileDropZone onFile={handleFile} disabled={importing} />
              <p className="onboarding__hint">
                Xの「設定とプライバシー → アカウント → データのアーカイブをダウンロード」から取得したZIPファイルをそのまま読み込めます。
                非相互フォローの整理はこのブラウザ内だけで完結し、外部サーバーとは通信しません。
              </p>
            </div>
          )}

          {hasData && summary && (
            <>
              {tab === 'home' && (
                <>
                  <div className="home-greeting">
                    <h1>Hey, tidy!</h1>
                    <p>気になる人だけ、残そう。</p>
                  </div>
                  <HomeView
                    summary={summary}
                    accounts={accountList}
                    batchAccounts={batchAccounts}
                    batchSize={batchSize}
                    onSearchFocus={focusSearch}
                    onGotoPending={() => goto('tidy', 'pending')}
                    onGotoProtected={() => goto('protected', 'protected')}
                    onReview={openNextReview}
                  />
                </>
              )}

              {(tab === 'tidy' || tab === 'protected') && (
                <FollowTidyView
                  accounts={accountList}
                  overline={tab === 'protected' ? 'KEEPING' : 'READY TO REVIEW'}
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
                  searchRef={listSearchRef}
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

      <nav className="bottom-nav" aria-label="メインメニュー">
        {BOTTOM_NAV.slice(0, 2).map((item) => (
          <button
            key={item.id}
            type="button"
            className={`bottom-nav__item${isCurrent(item.id) ? ' active' : ''}`}
            onClick={() => goto(item.id)}
          >
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </button>
        ))}

        <button
          type="button"
          className="bottom-nav__fab"
          onClick={openCompose}
          aria-label="投稿を作る"
        >
          <Icon name="plus" size={24} />
        </button>

        {BOTTOM_NAV.slice(2).map((item) => (
          <button
            key={item.id}
            type="button"
            className={`bottom-nav__item${isCurrent(item.id) ? ' active' : ''}`}
            onClick={() => goto(item.id)}
          >
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App
