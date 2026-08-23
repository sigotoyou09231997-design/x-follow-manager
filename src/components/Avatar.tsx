import type { AccountRecord } from '../lib/types'

// アーカイブにはアイコン画像が含まれないので、頭文字のモノグラムで代用する。
// 色相を持たせるとモノトーンの基調が崩れるため、明度違いのグレーだけを使う。
const GRADIENTS = [
  'linear-gradient(135deg, #4a4a50, #26262a)',
  'linear-gradient(135deg, #5c5c63, #2f2f34)',
  'linear-gradient(135deg, #3c3c42, #1b1b1e)',
  'linear-gradient(135deg, #6b6b72, #3a3a3f)',
  'linear-gradient(135deg, #55555c, #232327)',
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
