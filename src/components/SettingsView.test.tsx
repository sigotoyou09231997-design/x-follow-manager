import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('SettingsView: まとめて止める・再開の対象', () => {
  beforeEach(() => localStorage.clear())

  it('X・ディスコード・Yay を1つずつオンオフでき、初めは3つとも対象', () => {
    renderSettings()
    const section = screen.getByRole('region', { name: 'まとめて止める・再開の対象' })

    for (const label of ['X', 'ディスコード', 'Yay']) {
      expect(within(section).getByRole('switch', { name: label })).toBeChecked()
    }

    fireEvent.click(within(section).getByRole('switch', { name: 'ディスコード' }))

    expect(within(section).getByRole('switch', { name: 'ディスコード' })).not.toBeChecked()
    expect(within(section).getByRole('switch', { name: 'X' })).toBeChecked()
    expect(JSON.parse(localStorage.getItem('sns-all-pause-targets') ?? '{}')).toEqual({ x: true, discord: false, yay: true, xrepeat: true })
  })

  it('開き直しても、切り替えを覚えている', () => {
    localStorage.setItem('sns-all-pause-targets', JSON.stringify({ x: false, discord: true, yay: true }))
    renderSettings()

    expect(screen.getByRole('switch', { name: 'X' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Yay' })).toBeChecked()
  })
})

describe('SettingsView: トップに出す投稿先', () => {
  beforeEach(() => localStorage.clear())

  it('1つずつオンオフでき、外したものは「まとめて止める・再開の対象」で選べなくなる', () => {
    renderSettings()
    const shown = screen.getByRole('region', { name: 'トップに出す投稿先' })
    expect(within(shown).getByRole('switch', { name: 'Xをトップに出す' })).toBeChecked()

    fireEvent.click(within(shown).getByRole('switch', { name: 'Xをトップに出す' }))

    expect(within(shown).getByRole('switch', { name: 'Xをトップに出す' })).not.toBeChecked()
    expect(JSON.parse(localStorage.getItem('sns-top-shown') ?? '{}')).toEqual({ x: false, discord: true, yay: true, xrepeat: true })
    const bulk = screen.getByRole('region', { name: 'まとめて止める・再開の対象' })
    expect(within(bulk).getByRole('switch', { name: 'X' })).toBeDisabled()
    expect(within(bulk).getByText('トップに出していないので、対象外です')).toBeInTheDocument()
  })
})

