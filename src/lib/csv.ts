import type { AccountRecord } from './types'

const STATUS_LABEL: Record<AccountRecord['status'], string> = {
  pending: 'pending',
  done: 'done',
  protected: 'protected',
  skipped: 'skipped',
}

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function accountsToCsv(accounts: AccountRecord[]): string {
  const header = ['username', 'displayName', 'status', 'profileUrl']
  const lines = [header.join(',')]
  for (const account of accounts) {
    const row = [
      account.username ?? '',
      account.displayName ?? '',
      STATUS_LABEL[account.status],
      account.profileUrl,
    ].map(escapeCsvField)
    lines.push(row.join(','))
  }
  return lines.join('\n')
}

export function downloadCsv(filename: string, accounts: AccountRecord[]): void {
  const csv = accountsToCsv(accounts)
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
