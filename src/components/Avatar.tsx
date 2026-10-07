import type { AccountRecord } from '../lib/types'

// アーカイブにはアイコン画像が含まれないので、頭文字のモノグラムで代用する。
// iOS の連絡先と同じく、縦にごく薄いグラデーションをかけた灰色系でそろえる。
// 色味は微妙にずらすだけで、彩度は上げない（一覧に並んだときに賑やかになるため）。
const GRADIENTS = [
  'linear-gradient(180deg, #a2a7b3, #7d838f)',
  'linear-gradient(180deg, #a6a6a1, #81817c)',
  'linear-gradient(180deg, #9aa7b8, #76869a)',
  'linear-gradient(180deg, #aaa4b3, #868092)',
  'linear-gradient(180deg, #9aaaa7, #758986)',
]

function hash(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0
  return Math.abs(h)
}

function initialsOf(account: Pick<AccountRecord, 'displayName' | 'username' | 'accountId'>): string {
  const source = account.displayName || account.username || account.accountId || '?'
  return [...source].slice(0, 2).join('').toUpperCase()
}

interface Props {
  account: Pick<AccountRecord, 'key' | 'displayName' | 'username' | 'accountId'>
  size?: number
  className?: string
}

export function Avatar({ account, size = 40, className }: Props) {
  const gradient = GRADIENTS[hash(account.key ?? '') % GRADIENTS.length]
  return (
    <span
      className={className ? `avatar ${className}` : 'avatar'}
      style={{
        width: size,
        height: size,
        background: gradient,
        fontSize: Math.round(size * 0.34),
      }}
      aria-hidden="true"
    >
      {initialsOf(account)}
    </span>
  )
}
