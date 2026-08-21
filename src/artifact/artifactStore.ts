import { getAccountKey } from '../lib/accountKey'
import type { AccountRecord, AccountStatus, NormalizedAccount } from '../lib/types'
import type { ArtifactError } from './claudeRuntime'

// Artifact版の永続化層。db.ts(Dexie)と同じ関数シグネチャを提供するが、
// 実データはこのページ自身がpublishする完全なHTML(の中の#app-state)に
// 埋め込まれた状態で、claude.aiが全ビューア間の配信を担う。

export const META_KEYS = {
  followingCount: 'followingCount',
  followersCount: 'followersCount',
  lastImportedAt: 'lastImportedAt',
  archiveFingerprint: 'archiveFingerprint',
  currentBatchKeys: 'currentBatchKeys',
} as const

interface StoreState {
  accounts: Record<string, AccountRecord>
  meta: Record<string, unknown>
}

const STATE_EL_ID = 'app-state'
const TEMPLATE_EL_ID = 'app-template'
const OUTBOX_KEY = 'x-follow-manager:pending-state'
const PUBLISH_DEBOUNCE_MS = 900

function readJsonScript<T>(id: string, fallback: T): T {
  const el = document.getElementById(id)
  if (!el || !el.textContent) return fallback
  try {
    return JSON.parse(el.textContent) as T
  } catch {
    return fallback
  }
}

// sessionStorageはサンドボックス化されたiframe(Artifactの実行環境)や
// Safariのストレージ制限下で例外を投げることがある。ここで失敗しても
// アプリ本体の起動を妨げないよう、常に例外を握りつぶす。
function safeSessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSessionStorageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // 無視: 未確定の変更の退避に失敗しても、ローカル表示自体は継続する
  }
}

function safeSessionStorageRemove(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // 無視
  }
}

function emptyState(): StoreState {
  return { accounts: {}, meta: {} }
}

// 新しい方(updatedAtが大きい方)のアカウントレコードを採用してマージする。
// publish()がconflictで拒否されリロードを跨ぐ際、取りこぼした自分のローカル変更を
// 復元するために使う。
function mergeStates(base: StoreState, incoming: StoreState): StoreState {
  const accounts: Record<string, AccountRecord> = { ...base.accounts }
  for (const [key, record] of Object.entries(incoming.accounts)) {
    const existing = accounts[key]
    if (!existing || (record.updatedAt ?? 0) > (existing.updatedAt ?? -1)) {
      accounts[key] = record
    }
  }
  return { accounts, meta: { ...base.meta, ...incoming.meta } }
}

function bootstrapState(): StoreState {
  const fresh = readJsonScript<StoreState>(STATE_EL_ID, emptyState())
  const pendingRaw = safeSessionStorageGet(OUTBOX_KEY)
  if (!pendingRaw) return fresh
  try {
    const pending = JSON.parse(pendingRaw) as StoreState
    return mergeStates(fresh, pending)
  } catch {
    safeSessionStorageRemove(OUTBOX_KEY)
    return fresh
  }
}

// bootstrapState自体が想定外の例外を投げても、アプリの起動(Reactのmount)を
// 絶対に止めないようにする。ここが失敗するとページ全体が白紙になってしまうため。
let state: StoreState
try {
  state = bootstrapState()
} catch (err) {
  console.warn('artifactStore bootstrap failed, starting with empty state', err)
  state = emptyState()
}
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function subscribeStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getStoreState(): StoreState {
  return state
}

// `<` を < にエスケープして、JSON文字列が <script> タグの中身として
// 埋め込まれても </script> として誤って解釈されないようにする。
function escapeForScriptTag(json: string): string {
  return json.replace(/</g, '\\u003c')
}

// テンプレート文字列中の <script id="..." type="application/json">...</script> を
// id指定でピンポイント置換する。バンドルされたJS自身のソースコードにも
// "app-state"/"app-template" という文字列がそのまま含まれるため、
// 単純な文字列全置換ではなくタグの位置で特定する必要がある。
function fillScriptTag(html: string, id: string, content: string): string {
  const re = new RegExp(`(<script id="${id}" type="application/json">)[\\s\\S]*?(<\\/script>)`)
  if (!re.test(html)) throw new Error(`could not find #${id} script tag in page template`)
  return html.replace(re, (_match, open: string, close: string) => `${open}${content}${close}`)
}

function renderFullPage(nextState: StoreState): string {
  const template = readJsonScript<string>(TEMPLATE_EL_ID, '')
  if (!template) throw new Error('page template (#app-template) not found')
  const escapedState = escapeForScriptTag(JSON.stringify(nextState))
  const escapedTemplate = escapeForScriptTag(JSON.stringify(template))
  let html = fillScriptTag(template, 'app-state', escapedState)
  html = fillScriptTag(html, 'app-template', escapedTemplate)
  return html
}

let publishTimer: ReturnType<typeof setTimeout> | undefined
let publishing = false
let republishNeeded = false

function isArtifactError(err: unknown): err is ArtifactError {
  return typeof err === 'object' && err !== null && 'code' in err
}

async function flush(): Promise<void> {
  if (publishing) {
    republishNeeded = true
    return
  }
  publishing = true
  try {
    const artifact = await window.claude?.use('artifact')
    if (!artifact) return

    const html = renderFullPage(state)
    await artifact.publish(html)
    safeSessionStorageRemove(OUTBOX_KEY)
  } catch (err) {
    // conflict時はホスト側が既にこのビューを最新版へリロードするので、
    // sessionStorageに残した未確定の変更は次回起動時のbootstrapStateで再適用される。
    if (isArtifactError(err)) {
      console.warn('artifact publish failed', err.code, err.message)
    } else {
      console.warn('artifact publish failed', err)
    }
  } finally {
    publishing = false
    if (republishNeeded) {
      republishNeeded = false
      void flush()
    }
  }
}

function scheduleFlush(): void {
  safeSessionStorageSet(OUTBOX_KEY, JSON.stringify(state))
  if (publishTimer) return
  publishTimer = setTimeout(() => {
    publishTimer = undefined
    void flush()
  }, PUBLISH_DEBOUNCE_MS)
}

function mutate(fn: (draft: StoreState) => void): void {
  const next: StoreState = { accounts: { ...state.accounts }, meta: { ...state.meta } }
  fn(next)
  state = next
  notify()
  scheduleFlush()
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return state.meta[key] as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  mutate((draft) => {
    draft.meta[key] = value
  })
}

/**
 * 新しく計算した非相互フォロー一覧を状態へ反映する。
 * 既存レコードの status / protectedAt / completedAt はキーで引き継ぎ、
 * 新規アカウントは pending として追加する。
 */
export async function replaceNonMutualAccounts(
  accounts: NormalizedAccount[],
  fingerprint?: string
): Promise<void> {
  const now = Date.now()
  const incoming = new Map<string, NormalizedAccount>()
  for (const account of accounts) {
    const key = getAccountKey(account)
    if (!key) continue
    if (!incoming.has(key)) incoming.set(key, account)
  }

  mutate((draft) => {
    const nextAccounts: Record<string, AccountRecord> = {}
    for (const [key, account] of incoming) {
      const prev = draft.accounts[key]
      nextAccounts[key] = {
        ...account,
        key,
        status: prev?.status ?? 'pending',
        protectedAt: prev?.protectedAt,
        completedAt: prev?.completedAt,
        importedAt: prev?.importedAt ?? now,
        updatedAt: prev?.updatedAt ?? now,
        archiveFingerprint: fingerprint,
      }
    }
    draft.accounts = nextAccounts
    draft.meta[META_KEYS.lastImportedAt] = now
    if (fingerprint) draft.meta[META_KEYS.archiveFingerprint] = fingerprint
  })
}

export async function setAccountStatus(key: string, status: AccountStatus): Promise<void> {
  const now = Date.now()
  mutate((draft) => {
    const existing = draft.accounts[key]
    if (!existing) return
    draft.accounts[key] = {
      ...existing,
      status,
      protectedAt: status === 'protected' ? now : undefined,
      completedAt: status === 'done' ? now : undefined,
      updatedAt: now,
    }
  })
}

export async function clearAllData(): Promise<void> {
  mutate((draft) => {
    draft.accounts = {}
    draft.meta = {}
  })
}

export async function getNextBatchKeys(size: number): Promise<string[]> {
  const pending = Object.values(state.accounts)
    .filter((a) => a.status === 'pending')
    .sort((a, b) => a.importedAt - b.importedAt)
  return pending.slice(0, size).map((a) => a.key)
}
