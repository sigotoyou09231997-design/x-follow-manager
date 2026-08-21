import { accountsToCsv } from '../lib/csv'
import type { AccountRecord } from '../lib/types'
import type { DownloadsError } from './claudeRuntime'

function isDownloadsError(err: unknown): err is DownloadsError {
  return typeof err === 'object' && err !== null && 'code' in err
}

export async function downloadCsv(filename: string, accounts: AccountRecord[]): Promise<void> {
  const csv = `﻿${accountsToCsv(accounts)}`
  const downloads = await window.claude?.use('downloads')
  if (!downloads) {
    window.alert('この環境ではCSVの書き出しに対応していません。')
    return
  }

  try {
    await downloads.save({ filename, data: csv })
    return
  } catch (err) {
    if (isDownloadsError(err) && err.code === 'extension_not_enabled') {
      // .csvが許可されていない環境向けに.txtへフォールバック
      try {
        await downloads.save({ filename: filename.replace(/\.csv$/i, '.txt'), data: csv })
        return
      } catch {
        // fallthrough to error handling below
      }
    }
    if (isDownloadsError(err) && err.code === 'declined') return
    window.alert('CSVの書き出しに失敗しました。')
  }
}
