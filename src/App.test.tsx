import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// 重い画面（Supabase・サーバー前提）は中身を差し替え、画面のつながり（どこから何が開き、どこへ戻るか）だけを見る。
vi.mock('./components/autopost/AutoPostView', () => ({
  AutoPostHome: ({ onOpenDetail }: { onOpenDetail: () => void }) => (
    <div>
      <p>自動投稿のトップ</p>
      <button type="button" onClick={onOpenDetail}>
        文や回数を変える
      </button>
    </div>
  ),
  AutoPostView: () => <p>自動投稿の詳細</p>,
}))
vi.mock('./components/schedule/ScheduleView', () => ({ ScheduleView: () => <p>予約投稿の中身</p> }))
vi.mock('./components/PushSettings', () => ({ PushSettings: () => null }))

import App from './App'

afterEach(cleanup)

const header = () => screen.getByRole('banner')
const openSettings = () => fireEvent.click(screen.getByRole('button', { name: '設定を開く' }))
const openFeature = async (label: RegExp) => {
  const list = await screen.findByRole('region', { name: '機能' })
  fireEvent.click(within(list).getByRole('button', { name: label }))
}

describe('App: 自動投稿の1画面が入口', () => {
  it('最初に自動投稿のトップが出て、メニューバー・＋ボタン・検索はもう無い', async () => {
    const { container } = render(<App />)

    expect(await screen.findByText('自動投稿のトップ')).toBeInTheDocument()
    expect(container.querySelector('.bottom-nav, .side-nav, .bottom-nav__fab')).toBeNull()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(within(header()).queryByRole('searchbox')).not.toBeInTheDocument()
    // トップには戻る先が無い。右上に設定だけある。
    expect(within(header()).queryByRole('button', { name: /へ戻る/ })).not.toBeInTheDocument()
    expect(within(header()).getByRole('button', { name: '設定を開く' })).toBeInTheDocument()
  })

  it('設定を開くと機能の一覧があり、ヘッダーの戻るでトップへ戻れる', async () => {
    render(<App />)
    await screen.findByText('自動投稿のトップ')

    openSettings()
    expect(await screen.findByRole('region', { name: '機能' })).toBeInTheDocument()
    expect(within(header()).getByText('設定')).toBeInTheDocument()

    fireEvent.click(within(header()).getByRole('button', { name: '自動投稿へ戻る' }))
    expect(await screen.findByText('自動投稿のトップ')).toBeInTheDocument()
  })

  it('設定から開いた機能は、戻ると設定に戻る（トップではなく1つ前）', async () => {
    render(<App />)
    await screen.findByText('自動投稿のトップ')

    openSettings()
    await openFeature(/^予約投稿/)
    expect(await screen.findByText('予約投稿の中身')).toBeInTheDocument()
    expect(within(header()).getByText('予約投稿')).toBeInTheDocument()

    fireEvent.click(within(header()).getByRole('button', { name: '設定へ戻る' }))
    expect(await screen.findByRole('region', { name: '機能' })).toBeInTheDocument()
  })

  it('トップの「文や回数を変える」で詳細を開き、戻ると設定になる', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '文や回数を変える' }))
    expect(await screen.findByText('自動投稿の詳細')).toBeInTheDocument()

    fireEvent.click(within(header()).getByRole('button', { name: '設定へ戻る' }))
    expect(await screen.findByRole('region', { name: '機能' })).toBeInTheDocument()
  })

  it('アーカイブが未読み込みで、フォロー整理・残すリスト・履歴を開くと、読み込みの案内が出る', async () => {
    render(<App />)
    await screen.findByText('自動投稿のトップ')

    openSettings()
    for (const label of [/^フォロー整理/, /^残すリスト/, /^履歴/]) {
      await openFeature(label)
      expect(await screen.findByText('まずアーカイブを読み込みます')).toBeInTheDocument()
      fireEvent.click(within(header()).getByRole('button', { name: '設定へ戻る' }))
    }
  })
})

describe('App: 下に付いてくるメニュー', () => {
  const fab = () => screen.getByRole('button', { name: 'メニューを開く' })
  const menu = () => screen.getByRole('dialog', { name: 'メニュー' })

  it('どの画面にも丸いボタンがあり、押すとメニューが開いて、各画面の入口が並ぶ', async () => {
    render(<App />)
    await screen.findByText('自動投稿のトップ')
    expect(screen.queryByRole('dialog', { name: 'メニュー' })).not.toBeInTheDocument()

    fireEvent.click(fab())
    for (const label of ['自動投稿（トップ）', '自動投稿の文と設定', '予約投稿', 'フォロー整理', '残すリスト', '履歴', '設定']) {
      expect(within(menu()).getByRole('button', { name: new RegExp(`^${label.replace(/[（）]/g, '.')}`) })).toBeInTheDocument()
    }
  })

  it('選んだ画面へ移り、メニューは閉じる。移った先にもボタンが付いている', async () => {
    render(<App />)
    await screen.findByText('自動投稿のトップ')
    fireEvent.click(fab())
    fireEvent.click(within(menu()).getByRole('button', { name: /^予約投稿/ }))

    expect(await screen.findByText('予約投稿の中身')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'メニュー' })).not.toBeInTheDocument()
    expect(fab()).toBeInTheDocument()
  })

  it('設定へも、メニューから一度で行ける（トップの右上の歯車を探さなくていい）', async () => {
    render(<App />)
    await screen.findByText('自動投稿のトップ')
    fireEvent.click(fab())
    fireEvent.click(within(menu()).getByRole('button', { name: /^設定/ }))
    expect(await screen.findByRole('region', { name: '機能' })).toBeInTheDocument()
  })

  it('いまの画面に「いまここ」が付く', async () => {
    render(<App />)
    await screen.findByText('自動投稿のトップ')
    fireEvent.click(fab())
    const here = within(menu()).getByRole('button', { name: /いまここ/ })
    expect(here).toHaveAttribute('aria-current', 'page')
    expect(here).toHaveTextContent('自動投稿（トップ）')
  })

  it('背景を押す・「閉じる」・Esc のどれでも閉じる。何も選んでいなければ、画面は変わらない', async () => {
    render(<App />)
    await screen.findByText('自動投稿のトップ')

    fireEvent.click(fab())
    fireEvent.click(screen.getByRole('button', { name: 'メニューを閉じる' }))
    expect(screen.queryByRole('dialog', { name: 'メニュー' })).not.toBeInTheDocument()

    fireEvent.click(fab())
    fireEvent.click(within(menu()).getByRole('button', { name: /閉じる/ }))
    expect(screen.queryByRole('dialog', { name: 'メニュー' })).not.toBeInTheDocument()

    fireEvent.click(fab())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'メニュー' })).not.toBeInTheDocument())
    expect(screen.getByText('自動投稿のトップ')).toBeInTheDocument()
  })
})
