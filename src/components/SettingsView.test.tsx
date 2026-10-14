import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// 通知の設定は Supabase を連れてくるので、ここでは中身を見ない。
vi.mock('./PushSettings', () => ({ PushSettings: () => null }))

import { SettingsView } from './SettingsView'

afterEach(cleanup)

function renderSettings(props: Partial<React.ComponentProps<typeof SettingsView>> = {}) {
  const onOpenFeature = vi.fn()
  render(
    <SettingsView
      onOpenFeature={onOpenFeature}
      onReimport={() => {}}
      onClearAll={async () => {}}
      importing={false}
      {...props}
    />
  )
  return { onOpenFeature }
}

describe('SettingsView: 機能の一覧', () => {
  it('トップの1画面に載せていない機能を、すべてここから開ける', () => {
    renderSettings()
    const list = screen.getByRole('region', { name: '機能' })

    for (const label of ['自動投稿の文と設定', '予約投稿', 'フォロー整理', '残すリスト', '履歴']) {
      expect(within(list).getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument()
    }
  })

  it('押した機能の画面を開くよう知らせる', () => {
    const { onOpenFeature } = renderSettings()
    const list = screen.getByRole('region', { name: '機能' })

    fireEvent.click(within(list).getByRole('button', { name: /^自動投稿の文と設定/ }))
    fireEvent.click(within(list).getByRole('button', { name: /^予約投稿/ }))
    fireEvent.click(within(list).getByRole('button', { name: /^フォロー整理/ }))
    fireEvent.click(within(list).getByRole('button', { name: /^残すリスト/ }))
    fireEvent.click(within(list).getByRole('button', { name: /^履歴/ }))

    expect(onOpenFeature.mock.calls.map(([target]) => target)).toEqual(['autopost', 'schedule', 'tidy', 'protected', 'history'])
  })

  it('アーカイブを読み込み済みなら、フォロー整理と残すリストに人数を出す', () => {
    renderSettings({ tidyCounts: { pending: 1234, protected: 5 } })

    expect(screen.getByText('非相互フォローの確認（未確認 1,234人）')).toBeInTheDocument()
    expect(screen.getByText('残すと決めた 5人')).toBeInTheDocument()
  })

  it('読み込み前は人数を出さず、読み込むと使えることを伝える', () => {
    renderSettings()

    expect(screen.getByText('アーカイブを読み込むと、非相互フォローを整理できます')).toBeInTheDocument()
    expect(screen.queryByText(/未確認 \d/)).not.toBeInTheDocument()
  })
})
