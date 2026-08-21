import { describe, expect, it } from 'vitest'
import { parseArchiveFile } from './archiveParser'
import { computeNonMutual } from './nonMutual'
import { buildArchiveZip, buildCorruptZip, type FixtureEntry } from '../test/fixtures/buildArchiveZip'

describe('parseArchiveFile', () => {
  it('parses window.YTD.*.partN wrapped following/follower files', async () => {
    const zip = await buildArchiveZip({
      following: [{ accountId: '1', username: 'a' }],
      followers: [{ accountId: '1', username: 'a' }],
    })

    const result = await parseArchiveFile(zip)

    expect(result.following).toHaveLength(1)
    expect(result.followers).toHaveLength(1)
    expect(result.following[0].accountId).toBe('1')
    expect(result.warnings).toHaveLength(0)
  })

  it('Case 2: handles a following:7000 / followers:6000 scale archive', async () => {
    const followers: FixtureEntry[] = Array.from({ length: 6000 }, (_, i) => ({
      accountId: String(i),
    }))
    const following: FixtureEntry[] = [
      ...followers.slice(0, 5000),
      ...Array.from({ length: 2000 }, (_, i) => ({ accountId: String(50000 + i) })),
    ]

    const zip = await buildArchiveZip({ following, followers })
    const result = await parseArchiveFile(zip)

    expect(result.following).toHaveLength(7000)
    expect(result.followers).toHaveLength(6000)

    const nonMutual = computeNonMutual(result.following, result.followers)
    expect(nonMutual).toHaveLength(2000)
  })

  it('Case 6: rejects when the zip is corrupted', async () => {
    const zip = await buildCorruptZip()
    await expect(parseArchiveFile(zip)).rejects.toThrow()
  })

  it('Case 7: warns when the followers file is missing', async () => {
    const zip = await buildArchiveZip({
      following: [{ accountId: '1' }],
      includeFollowerFile: false,
    })

    const result = await parseArchiveFile(zip)

    expect(result.followers).toHaveLength(0)
    expect(result.warnings).toContain('フォロワーデータが見つかりませんでした')
  })

  it('Case 8: warns when the following file is missing', async () => {
    const zip = await buildArchiveZip({
      followers: [{ accountId: '1' }],
      includeFollowingFile: false,
    })

    const result = await parseArchiveFile(zip)

    expect(result.following).toHaveLength(0)
    expect(result.warnings).toContain('フォロー中データが見つかりませんでした')
  })

  it('detects files nested inside a data/ directory and records their paths', async () => {
    const zip = await buildArchiveZip({ following: [{ accountId: '1' }], followers: [] })
    const result = await parseArchiveFile(zip)
    expect(result.detectedFiles.some((path) => path.includes('following'))).toBe(true)
  })
})
