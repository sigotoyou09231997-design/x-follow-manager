import Dexie, { type Table } from 'dexie'
import { getAccountKey } from '../lib/accountKey'
import type { AccountRecord, AccountStatus, NormalizedAccount } from '../lib/types'

interface MetaRow {
  key: string
  value: unknown
}

export const META_KEYS = {
  followingCount: 'followingCount',
  followersCount: 'followersCount',
  lastImportedAt: 'lastImportedAt',
  archiveFingerprint: 'archiveFingerprint',
  currentBatchKeys: 'currentBatchKeys',
} as const

class XFollowManagerDb extends Dexie {
  accounts!: Table<AccountRecord, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super('x-follow-manager')
    this.version(1).stores({
      accounts: 'key, accountId, username, status, importedAt',
      meta: 'key',
    })
  }
}

export const db = new XFollowManagerDb()

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key)
  return row?.value as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

/**
 * 新しく計算した非相互フォロー一覧をDBへ反映する。
 * 既存レコードの status / protectedAt / completedAt はキー（accountId優先、
 * なければ正規化username）で引き継ぎ、新規アカウントは pending として追加する。
 * 新しい一覧に含まれなくなったアカウント（相互化した／フォロー解除済み）は
 * 対象一覧から取り除く。
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

  await db.transaction('rw', db.accounts, db.meta, async () => {
    const existing = await db.accounts.toArray()
    const existingByKey = new Map(existing.map((row) => [row.key, row]))

    const nextRecords: AccountRecord[] = []
    for (const [key, account] of incoming) {
      const prev = existingByKey.get(key)
      nextRecords.push({
        ...account,
        key,
        status: prev?.status ?? 'pending',
        protectedAt: prev?.protectedAt,
        completedAt: prev?.completedAt,
        importedAt: prev?.importedAt ?? now,
        updatedAt: prev?.updatedAt ?? now,
        archiveFingerprint: fingerprint,
      })
    }

    await db.accounts.clear()
    await db.accounts.bulkPut(nextRecords)

    await setMeta(META_KEYS.lastImportedAt, now)
    if (fingerprint) await setMeta(META_KEYS.archiveFingerprint, fingerprint)
  })
}

export async function setAccountStatus(key: string, status: AccountStatus): Promise<void> {
  const now = Date.now()
  await db.accounts.update(key, {
    status,
    protectedAt: status === 'protected' ? now : undefined,
    completedAt: status === 'done' ? now : undefined,
    updatedAt: now,
  })
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.accounts, db.meta, async () => {
    await db.accounts.clear()
    await db.meta.clear()
  })
}

export async function getNextBatchKeys(size: number): Promise<string[]> {
  const pending = await db.accounts.where('status').equals('pending').sortBy('importedAt')
  return pending.slice(0, size).map((row) => row.key)
}
