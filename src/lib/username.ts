/**
 * username比較用の正規化。
 * 先頭 `@`、前後の空白を除去し、大文字小文字を無視して比較できるようにする。
 */
export function normalizeUsername(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim().replace(/^@+/, '').trim()
  if (!trimmed) return undefined
  return trimmed.toLowerCase()
}
