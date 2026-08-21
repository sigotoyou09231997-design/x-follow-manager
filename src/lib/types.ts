// X(旧Twitter)公式アーカイブから抽出したアカウント情報の正規化済み表現。
// 公式アーカイブの following.js / follower.js には accountId と userLink しか
// 含まれないことが多く、username / displayName は取得できない場合がある。
export interface NormalizedAccount {
  accountId?: string
  username?: string
  displayName?: string
  userLink?: string
  profileUrl: string
}

export type AccountStatus = 'pending' | 'done' | 'protected' | 'skipped'

export interface AccountRecord extends NormalizedAccount {
  key: string
  status: AccountStatus
  protectedAt?: number
  completedAt?: number
  importedAt: number
  archiveFingerprint?: string
  // 端末間同期のマージ判定（新しい方を採用）に使うタイムスタンプ。
  updatedAt: number
}

export interface ParsedArchive {
  following: NormalizedAccount[]
  followers: NormalizedAccount[]
  warnings: string[]
  detectedFiles: string[]
}
