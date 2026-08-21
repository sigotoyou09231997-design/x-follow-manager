import JSZip from 'jszip'

export interface FixtureEntry {
  accountId?: string
  username?: string
}

function toYtdJs(kind: 'following' | 'follower', entries: FixtureEntry[]): string {
  const records = entries.map((entry) => ({
    [kind]: {
      accountId: entry.accountId,
      userLink: entry.accountId
        ? `https://twitter.com/intent/user?user_id=${entry.accountId}`
        : undefined,
      ...(entry.username ? { username: entry.username } : {}),
    },
  }))
  return `window.YTD.${kind}.part0 = ${JSON.stringify(records)}`
}

export interface BuildArchiveOptions {
  following?: FixtureEntry[]
  followers?: FixtureEntry[]
  includeFollowingFile?: boolean
  includeFollowerFile?: boolean
}

export async function buildArchiveZip(options: BuildArchiveOptions): Promise<ArrayBuffer> {
  const zip = new JSZip()
  const dataDir = zip.folder('data')!

  if (options.includeFollowingFile !== false) {
    dataDir.file('following.js', toYtdJs('following', options.following ?? []))
  }
  if (options.includeFollowerFile !== false) {
    dataDir.file('follower.js', toYtdJs('follower', options.followers ?? []))
  }

  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}

export async function buildCorruptZip(): Promise<ArrayBuffer> {
  const bytes = new TextEncoder().encode('not a real zip file')
  return bytes.buffer as ArrayBuffer
}
