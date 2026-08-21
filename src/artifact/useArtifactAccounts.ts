import { useSyncExternalStore } from 'react'
import { subscribeStore, getStoreState, META_KEYS } from './artifactStore'
import type { AccountRecord } from '../lib/types'
import type { Summary } from '../hooks/useAccounts'

export function useAccounts(): AccountRecord[] | undefined {
  const state = useSyncExternalStore(subscribeStore, getStoreState)
  return Object.values(state.accounts)
}

export function useCurrentBatchKeys(): string[] {
  const state = useSyncExternalStore(subscribeStore, getStoreState)
  return (state.meta[META_KEYS.currentBatchKeys] as string[] | undefined) ?? []
}

export function useSummary(accounts: AccountRecord[] | undefined): Summary | undefined {
  const state = useSyncExternalStore(subscribeStore, getStoreState)
  if (!accounts) return undefined

  let pending = 0
  let done = 0
  let protectedCount = 0
  for (const account of accounts) {
    if (account.status === 'pending') pending += 1
    else if (account.status === 'done') done += 1
    else if (account.status === 'protected') protectedCount += 1
  }

  return {
    followingCount: (state.meta[META_KEYS.followingCount] as number) ?? 0,
    followersCount: (state.meta[META_KEYS.followersCount] as number) ?? 0,
    total: accounts.length,
    pending,
    done,
    protected: protectedCount,
    lastImportedAt: state.meta[META_KEYS.lastImportedAt] as number | undefined,
  }
}
