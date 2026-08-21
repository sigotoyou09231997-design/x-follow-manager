import { getAccountKey } from './accountKey'
import { normalizeUsername } from './username'
import type { NormalizedAccount } from './types'

/**
 * following の中から followers に存在しないアカウント（非相互フォロー）を
 * すべて抽出する。件数の上限は設けない。
 */
export function computeNonMutual(
  following: NormalizedAccount[],
  followers: NormalizedAccount[]
): NormalizedAccount[] {
  const followerIds = new Set<string>()
  const followerUsernames = new Set<string>()

  for (const follower of followers) {
    if (follower.accountId) followerIds.add(follower.accountId)
    const normalized = normalizeUsername(follower.username)
    if (normalized) followerUsernames.add(normalized)
  }

  const isMutual = (account: NormalizedAccount): boolean => {
    if (account.accountId && followerIds.has(account.accountId)) return true
    const normalized = normalizeUsername(account.username)
    if (normalized && followerUsernames.has(normalized)) return true
    return false
  }

  const seen = new Set<string>()
  const result: NormalizedAccount[] = []

  for (const account of following) {
    if (isMutual(account)) continue
    const key = getAccountKey(account)
    if (!key) continue
    if (seen.has(key)) continue
    seen.add(key)
    result.push(account)
  }

  return result
}
