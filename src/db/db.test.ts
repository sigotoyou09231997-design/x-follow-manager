import { beforeEach, describe, expect, it } from 'vitest'
import { clearAllData, db, getNextBatchKeys, replaceNonMutualAccounts, setAccountStatus } from './db'
import { getAccountKey } from '../lib/accountKey'
import type { NormalizedAccount } from '../lib/types'

function makeAccounts(count: number, offset = 0): NormalizedAccount[] {
  return Array.from({ length: count }, (_, i) => {
    const id = String(offset + i)
    return { accountId: id, profileUrl: `https://x.com/intent/user?user_id=${id}` }
  })
}

beforeEach(async () => {
  await clearAllData()
})

describe('replaceNonMutualAccounts', () => {
  it('inserts new accounts as pending', async () => {
    await replaceNonMutualAccounts(makeAccounts(3))
    const rows = await db.accounts.toArray()
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.status === 'pending')).toBe(true)
  })

  it('carries over status for accounts that reappear after re-import', async () => {
    const accounts = makeAccounts(2)
    await replaceNonMutualAccounts(accounts)
    const key = getAccountKey(accounts[0])!
    await setAccountStatus(key, 'protected')

    await replaceNonMutualAccounts(accounts)

    const row = await db.accounts.get(key)
    expect(row?.status).toBe('protected')
  })

  it('drops accounts that are no longer non-mutual (they followed back or were unfollowed)', async () => {
    const accounts = makeAccounts(3)
    await replaceNonMutualAccounts(accounts)

    await replaceNonMutualAccounts(accounts.slice(0, 1))

    const rows = await db.accounts.toArray()
    expect(rows).toHaveLength(1)
  })
})

describe('getNextBatchKeys', () => {
  it('Case 9: protected accounts are excluded from the next batch', async () => {
    const accounts = makeAccounts(5)
    await replaceNonMutualAccounts(accounts)
    const protectedKey = getAccountKey(accounts[0])!
    await setAccountStatus(protectedKey, 'protected')

    const batch = await getNextBatchKeys(100)

    expect(batch).toHaveLength(4)
    expect(batch).not.toContain(protectedKey)
  })

  it('Case 10: selecting 100 with only 57 pending left returns 57', async () => {
    const accounts = makeAccounts(100)
    await replaceNonMutualAccounts(accounts)

    for (const account of accounts.slice(0, 43)) {
      const key = getAccountKey(account)!
      await setAccountStatus(key, 'done')
    }

    const batch = await getNextBatchKeys(100)

    expect(batch).toHaveLength(57)
  })
})
