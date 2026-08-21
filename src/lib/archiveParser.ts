import { openZip } from './zipCentralDirectory'
import type { NormalizedAccount, ParsedArchive } from './types'

// `window.YTD.following.part0 = [ ... ]` のようなJSラッパーを取り除いて
// JSON配列/オブジェクトのテキストだけを取り出す。
// eval()は使わず、プレフィックスと末尾のセミコロンを文字列操作で除去してからJSON.parseする。
function stripYtdWrapper(text: string): string {
  const trimmed = text.trim()
  const assignmentMatch = trimmed.match(/^window\.YTD\.[a-zA-Z0-9_]+\.part\d+\s*=\s*/)
  let body = assignmentMatch ? trimmed.slice(assignmentMatch[0].length) : trimmed
  body = body.trim()
  if (body.endsWith(';')) {
    body = body.slice(0, -1).trim()
  }
  return body
}

function parseJsonLike(text: string): unknown {
  const body = stripYtdWrapper(text)
  return JSON.parse(body)
}

// following.js / follower.js のレコードは通常 { "following": { accountId, userLink } }
// または { "follower": { accountId, userLink } } のようにラップされているが、
// アーカイブの世代差でフラットな形式や複数形キーの場合もあるため吸収する。
function unwrapEntry(entry: unknown): Record<string, unknown> | undefined {
  if (!entry || typeof entry !== 'object') return undefined
  const obj = entry as Record<string, unknown>
  for (const key of ['following', 'follower', 'followers', 'user']) {
    const inner = obj[key]
    if (inner && typeof inner === 'object') {
      return inner as Record<string, unknown>
    }
  }
  // 既にフラットな形式（accountId等を直接持つ）とみなす
  if ('accountId' in obj || 'username' in obj || 'screen_name' in obj || 'userLink' in obj) {
    return obj
  }
  return undefined
}

function extractUserLinkId(userLink: unknown): string | undefined {
  if (typeof userLink !== 'string') return undefined
  const match = userLink.match(/user_id=(\d+)/)
  return match ? match[1] : undefined
}

function toNormalizedAccount(raw: Record<string, unknown>): NormalizedAccount | undefined {
  const accountId =
    (typeof raw.accountId === 'string' && raw.accountId) ||
    (typeof raw.account_id === 'string' && raw.account_id) ||
    extractUserLinkId(raw.userLink) ||
    undefined

  const username =
    (typeof raw.username === 'string' && raw.username) ||
    (typeof raw.screen_name === 'string' && raw.screen_name) ||
    (typeof raw.screenName === 'string' && raw.screenName) ||
    (typeof raw.user_name === 'string' && raw.user_name) ||
    undefined

  const displayName =
    (typeof raw.displayName === 'string' && raw.displayName) ||
    (typeof raw.name === 'string' && raw.name) ||
    undefined

  const userLink = typeof raw.userLink === 'string' ? raw.userLink : undefined

  if (!accountId && !username) return undefined

  const profileUrl = username
    ? `https://x.com/${username}`
    : `https://x.com/intent/user?user_id=${accountId}`

  return { accountId, username, displayName, userLink, profileUrl }
}

function parseEntryArray(data: unknown): NormalizedAccount[] {
  if (!Array.isArray(data)) return []
  const result: NormalizedAccount[] = []
  for (const entry of data) {
    const flat = unwrapEntry(entry)
    if (!flat) continue
    const normalized = toNormalizedAccount(flat)
    if (normalized) result.push(normalized)
  }
  return result
}

const FOLLOWING_PATTERN = /(^|\/)following[^/]*\.(js|json)$/i
const FOLLOWER_PATTERN = /(^|\/)followers?[^/]*\.(js|json)$/i

export async function parseArchiveFile(file: File | Blob | ArrayBuffer): Promise<ParsedArchive> {
  const zip = await openZip(file)
  const detectedFiles: string[] = []
  const warnings: string[] = []

  const followingEntries: NormalizedAccount[] = []
  const followerEntries: NormalizedAccount[] = []

  const entries = [...zip.entries].sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    const path = entry.name
    if (path.endsWith('/')) continue

    const isFollowing = FOLLOWING_PATTERN.test(path)
    const isFollower = !isFollowing && FOLLOWER_PATTERN.test(path)
    if (!isFollowing && !isFollower) continue

    detectedFiles.push(path)

    let text: string
    try {
      text = await zip.readEntryText(entry)
    } catch {
      warnings.push(`${path} の読み込みに失敗しました`)
      continue
    }

    let data: unknown
    try {
      data = parseJsonLike(text)
    } catch {
      warnings.push(`${path} の解析に失敗しました（形式が不明です）`)
      continue
    }

    const normalized = parseEntryArray(data)
    if (isFollowing) {
      followingEntries.push(...normalized)
    } else {
      followerEntries.push(...normalized)
    }
  }

  if (followingEntries.length === 0) {
    warnings.push('フォロー中データが見つかりませんでした')
  }
  if (followerEntries.length === 0) {
    warnings.push('フォロワーデータが見つかりませんでした')
  }

  return {
    following: followingEntries,
    followers: followerEntries,
    warnings,
    detectedFiles,
  }
}
