import { describe, expect, it } from 'vitest'
import { computeNonMutual } from './nonMutual'
import type { NormalizedAccount } from './types'

function acc(accountId: string, username?: string): NormalizedAccount {
  return {
    accountId,
    username,
    profileUrl: username ? `https://x.com/${username}` : `https://x.com/intent/user?user_id=${accountId}`,
  }
}

describe('computeNonMutual', () => {
  it('Case 1: extracts the account that does not follow back', () => {
    const following = [acc('1', 'A'), acc('2', 'B'), acc('3', 'C')]
    const followers = [acc('2', 'B'), acc('3', 'C')]

    const result = computeNonMutual(following, followers)

    expect(result.map((a) => a.username)).toEqual(['A'])
  })

  it('Case 3: extracts all non-mutual accounts without a cap (1500 accounts)', () => {
    const followers = Array.from({ length: 6000 }, (_, i) => acc(String(i)))
    const following = [
      ...followers,
      ...Array.from({ length: 1500 }, (_, i) => acc(String(100000 + i))),
    ]

    const result = computeNonMutual(following, followers)

    expect(result).toHaveLength(1500)
  })

  it('Case 4: username comparison ignores case when accountId is unavailable', () => {
    const following: NormalizedAccount[] = [
      { username: 'Example', profileUrl: 'https://x.com/Example' },
    ]
    const followers: NormalizedAccount[] = [
      { username: 'EXAMPLE', profileUrl: 'https://x.com/EXAMPLE' },
    ]

    expect(computeNonMutual(following, followers)).toHaveLength(0)
  })

  it('Case 5: normalizes "@username" vs "username" before comparing', () => {
    const following: NormalizedAccount[] = [
      { username: '@example', profileUrl: 'https://x.com/example' },
    ]
    const followers: NormalizedAccount[] = [
      { username: 'example', profileUrl: 'https://x.com/example' },
    ]

    expect(computeNonMutual(following, followers)).toHaveLength(0)
  })

  it('deduplicates repeated entries in the following list', () => {
    const following = [acc('1', 'A'), acc('1', 'A')]
    const result = computeNonMutual(following, [])
    expect(result).toHaveLength(1)
  })
})
