import { normalizeUsername } from './username'
import type { NormalizedAccount } from './types'

/**
 * アカウントを一意に識別するキー。
 * 数値user IDが取得できる場合はそれを優先し、取れない場合のみ
 * 正規化したusernameにフォールバックする。
 */
export function getAccountKey(account: NormalizedAccount): string | undefined {
  if (account.accountId) return `id:${account.accountId}`
  const normalized = normalizeUsername(account.username)
  if (normalized) return `un:${normalized}`
  return undefined
}
