import { useLiveQuery } from 'dexie-react-hooks'
import { db, META_KEYS } from '../db/db'
import type { AccountRecord } from '../lib/types'

export interface Summary {
  followingCount: number
  followersCount: number
  total: number
  pending: number
  done: number
  protected: number
  lastImportedAt?: number
}

export function useAccounts(): AccountRecord[] | undefined {
  return useLiveQuery(() => db.accounts.toArray(), [])
}

export function useCurrentBatchKeys(): string[] {
  const row = useLiveQuery(() => db.meta.get(META_KEYS.currentBatchKeys), [])
  return (row?.value as string[] | undefined) ?? []
}

export function useSummary(accounts: AccountRecord[] | undefined): Summary | undefined {
  const meta = useLiveQuery(async () => {
    const [followingCount, followersCount, lastImportedAt] = await Promise.all([
      db.meta.get(META_KEYS.followingCount),
      db.meta.get(META_KEYS.followersCount),
      db.meta.get(META_KEYS.lastImportedAt),
    ])
    return {
      followingCount: (followingCount?.value as number) ?? 0,
      followersCount: (followersCount?.value as number) ?? 0,
      lastImportedAt: lastImportedAt?.value as number | undefined,
    }
  }, [])

  if (!accounts || !meta) return undefined

  let pending = 0
  let done = 0
  let protectedCount = 0
  for (const account of accounts) {
    if (account.status === 'pending') pending += 1
    else if (account.status === 'done') done += 1
    else if (account.status === 'protected') protectedCount += 1
  }

  return {
    followingCount: meta.followingCount,
    followersCount: meta.followersCount,
    total: accounts.length,
    pending,
    done,
    protected: protectedCount,
    lastImportedAt: meta.lastImportedAt,
  }
}
