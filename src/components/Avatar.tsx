import type { AccountRecord } from '../lib/types'

// アーカイブにはアイコン画像が含まれないので、頭文字のモノグラムで代用する。
// 画面全体がウォーム基調なので、灰色ではなく暖色〜ネイビーの濃淡でそろえる。
// 彩度は上げない（一覧に並んだときに絵文字のように賑やかになるため）。
const GRADIENTS = [
  'linear-gradient(135deg, #7a6450, #3c3028)',
  'linear-gradient(135deg, #8a7360, #4a3a2c)',
  'linear-gradient(135deg, #5c6b7a, #26313f)',
  'linear-gradient(135deg, #6f6357, #322b24)',
  'linear-gradient(135deg, #2f4260, #11213d)',
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
