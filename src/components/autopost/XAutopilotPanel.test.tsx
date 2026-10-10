import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutopilotState } from '../../lib/xAutopilot/types'
import { DEFAULT_SETTINGS, emptyUsage } from '../../lib/xAutopilot/types'
import type { ScheduledPost } from '../../lib/schedule/types'

const api = vi.hoisted(() => ({
  fetchAutopilot: vi.fn(),
  saveAutopilotSettings: vi.fn(),
  readAutopilotHistory: vi.fn(),
  buildAutopilotProfile: vi.fn(),
  previewAutopilotPost: vi.fn(),
  startAutopilot: vi.fn(),
  stopAutopilot: vi.fn(),
}))
vi.mock('../../lib/xAutopilot/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/xAutopilot/api')>()),
  ...api,
}))

const posts = vi.hoisted(() => ({ list: [] as unknown[], reload: vi.fn(), remove: vi.fn() }))
vi.mock('../../hooks/useScheduledPosts', () => ({
  useScheduledPosts: () => ({ posts: posts.list, loading: false, reload: posts.reload }),
}))
vi.mock('../../lib/schedule/postsStore', () => ({ deleteScheduledPost: posts.remove }))

import { XAutopilotError } from '../../lib/xAutopilot/api'
import { XAutopilotPanel } from './XAutopilotPanel'

function state(patch: Partial<AutopilotState> = {}): AutopilotState {
  return {
    enabled: false,
    settings: { ...DEFAULT_SETTINGS },
    xAccount: { username: 'me' },
    history: { total: 0, fetchedAt: null, newestAt: null, oldestAt: null },
    profileReady: false,
    profileBuiltAt: null,
    usage: emptyUsage('2026-10'),
    lastError: null,
    ...patch,
  }
}

const withProfile = (patch: Partial<AutopilotState> = {}) =>
  state({
    profileReady: true,
    profileBuiltAt: '2026-10-09T00:00:00Z',
    history: { total: 120, fetchedAt: '2026-10-09T00:00:00Z', newestAt: '2026-10-08T00:00:00Z', oldestAt: '2026-06-01T00:00:00Z' },
    ...patch,
  })

function post(id: string, patch: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    id,
    userId: 'u',
    status: 'scheduled',
    scheduledAt: '2026-10-11T03:00:00.000Z',
    segments: [{ text: `自動運転の本文 ${id}`, media: [] }],
    aiPrompt: `autopilot:2026-10-11#${id}`,
    attemptCount: 0,
    createdAt: '2026-10-10T00:00:00Z',
    updatedAt: '2026-10-10T00:00:00Z',
    ...patch,
  }
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
  posts.list = []
  posts.reload.mockReset().mockResolvedValue(undefined)
  posts.remove.mockReset().mockResolvedValue(undefined)
  api.fetchAutopilot.mockResolvedValue({ state: state() })
})

const button = (name: RegExp | string) => screen.getByRole('button', { name })

describe('XAutopilotPanel: 文体', () => {
  it('最初は、過去の投稿を読んで文体をまとめるボタンに費用の目安が付く', async () => {
    render(<XAutopilotPanel />)
    const start = await screen.findByRole('button', { name: /過去の投稿を読んで、文体をまとめる（約\d+円）/ })
    expect(start).toBeEnabled()
    expect(screen.getByText('まだ過去の投稿を読み込んでいません')).toBeInTheDocument()
    expect(screen.getByText(/Xと連携中（@me）/)).toBeInTheDocument()
  })

  it('押すと、読み込み → まとめの順に実行し、終わったら「まとめ済み」とだけ見せる（中身は出さない）', async () => {
    const order: string[] = []
    api.readAutopilotHistory.mockImplementation(async () => {
      order.push('read')
      return { state: state() }
    })
    api.buildAutopilotProfile.mockImplementation(async () => {
      order.push('profile')
      return { state: withProfile() }
    })
    render(<XAutopilotPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /過去の投稿を読んで、文体をまとめる/ }))
    expect(await screen.findByText('読み込んで、文体をまとめました')).toBeInTheDocument()
    expect(order).toEqual(['read', 'profile'])
    expect(screen.getByText(/文体のまとめ済み/)).toBeInTheDocument()
    expect(screen.getByText(/読み込み済み 120件/)).toBeInTheDocument()
    // 文体のまとめの中身（要約・語尾・話題）は、本人の希望で画面に出さない。
    expect(screen.queryByText('一人称・呼びかけ')).not.toBeInTheDocument()
    expect(screen.queryByText('よく使う語尾')).not.toBeInTheDocument()
    expect(screen.queryByText('よく書く話題')).not.toBeInTheDocument()
  })

  it('Xと連携していなければ押せず、連携の案内を出す', async () => {
    api.fetchAutopilot.mockResolvedValue({ state: state({ xAccount: null }) })
    render(<XAutopilotPanel />)
    expect(await screen.findByText(/Xと連携していません/)).toBeInTheDocument()
    expect(button(/過去の投稿を読んで/)).toBeDisabled()
  })

  it('文体があれば、新しい投稿だけの取り込みと、まとめ直し（費用つき）を出す', async () => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile() })
    api.readAutopilotHistory.mockResolvedValue({ state: withProfile(), result: { fetched: 7, added: 5, total: 125 } })
    render(<XAutopilotPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /新しい投稿だけ取り込む/ }))
    expect(await screen.findByText('新しく 5 件を取り込みました（読み取り 7 件）')).toBeInTheDocument()
    expect(api.readAutopilotHistory).toHaveBeenCalledWith()
    expect(button(/文体をまとめ直す（約\d+円）/)).toBeEnabled()
  })

  it('失敗の理由は、そのまま画面に出す（クレジット不足など）', async () => {
    api.readAutopilotHistory.mockRejectedValue(new XAutopilotError('X APIのクレジットが足りません（402）', 502))
    render(<XAutopilotPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /過去の投稿を読んで/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('クレジットが足りません')
    expect(api.buildAutopilotProfile).not.toHaveBeenCalled()
  })
})

describe('XAutopilotPanel: 試し書き', () => {
  it('文体が無ければ押せない。あれば1本書いて見せ、使われない案には理由を添える', async () => {
    render(<XAutopilotPanel />)
    expect(await screen.findByRole('button', { name: /試し書き/ })).toBeDisabled()
  })

  it('書いた本文を見せる。検査に落ちた案は、使われない理由つき', async () => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile() })
    api.previewAutopilotPost
      .mockResolvedValueOnce({ state: withProfile(), preview: { text: '今日はなんだか眠いかも', problems: [] } })
      .mockResolvedValueOnce({ state: withProfile(), preview: { text: 'https://example.com を見てね', problems: ['URLを含んでいる'] } })
    render(<XAutopilotPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /試し書き（約\d+円）/ }))
    expect(await screen.findByText('今日はなんだか眠いかも')).toBeInTheDocument()
    expect(screen.queryByText(/自動運転では使われません/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /試し書き/ }))
    expect(await screen.findByText(/自動運転では使われません（URLを含んでいる）/)).toBeInTheDocument()
  })
})

describe('XAutopilotPanel: 設定と費用の見積もり', () => {
  beforeEach(() => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile() })
  })

  it('標準・節約の月の目安を並べ、選んだ設定の月の目安を見せる', async () => {
    render(<XAutopilotPanel />)
    await screen.findByRole('group', { name: '文章の質（使うAI）' })
    expect(screen.getByText('標準（Opus 5.5）')).toBeInTheDocument()
    expect(screen.getByText('節約（Sonnet 5.5）')).toBeInTheDocument()
    expect(screen.getByText(/月の目安: 約910円/)).toBeInTheDocument() // 標準・1日3回（伝えた金額）
  })

  it('投稿数を変えると目安が変わり、保存ボタンが出る。保存は変えた項目だけを送る', async () => {
    api.saveAutopilotSettings.mockResolvedValue({ state: withProfile({ settings: { ...DEFAULT_SETTINGS, postsPerDay: 1 } }), rebuilt: false })
    render(<XAutopilotPanel />)
    const select = await screen.findByLabelText('1日の投稿数')
    expect(screen.queryByRole('button', { name: '設定を保存する' })).not.toBeInTheDocument()

    fireEvent.change(select, { target: { value: '1' } })
    expect(screen.getByText(/月の目安: 約360円/)).toBeInTheDocument()
    fireEvent.click(button('設定を保存する'))
    await waitFor(() => expect(api.saveAutopilotSettings).toHaveBeenCalledWith({ postsPerDay: 1 }))
    expect(await screen.findByText('保存しました')).toBeInTheDocument()
  })

  it('節約を選ぶと、月の目安が下がる', async () => {
    render(<XAutopilotPanel />)
    const saver = (await screen.findByRole('radio', { name: /節約/ })) as HTMLInputElement
    fireEvent.click(saver)
    expect(screen.getByText(/月の目安: 約560円/)).toBeInTheDocument()
  })

  it('今月の使用額と上限を見せる', async () => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile({ usage: { month: '2026-10', yen: 123.4, posts: 5, generations: 7 } }) })
    render(<XAutopilotPanel />)
    expect(await screen.findByText(/今月ここまで 約123円 \/ 上限 3,000円/)).toBeInTheDocument()
  })

  it('動作中に枠の設定を変えると、予約が作り直されることを伝える', async () => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile({ enabled: true }) })
    render(<XAutopilotPanel />)
    fireEvent.change(await screen.findByLabelText('1日の投稿数'), { target: { value: '5' } })
    expect(screen.getByText(/まだ出ていない予約は新しい設定で作り直されます/)).toBeInTheDocument()
  })
})

describe('XAutopilotPanel: 設定が確実に使われる', () => {
  beforeEach(() => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile() })
  })

  it('保存せずに「始める」を押しても、変えた設定を先に保存してから始める（保存済みの古い設定で始めない）', async () => {
    const order: string[] = []
    api.saveAutopilotSettings.mockImplementation(async (input: unknown) => {
      order.push(`save:${JSON.stringify(input)}`)
      return { state: withProfile({ settings: { ...DEFAULT_SETTINGS, postsPerDay: 2 } }) }
    })
    api.startAutopilot.mockImplementation(async () => {
      order.push('start')
      return { state: withProfile({ enabled: true, settings: { ...DEFAULT_SETTINGS, postsPerDay: 2 } }) }
    })
    render(<XAutopilotPanel />)
    fireEvent.change(await screen.findByLabelText('1日の投稿数'), { target: { value: '2' } })
    fireEvent.click(button('自動運転を始める'))
    expect(await screen.findByText('自動運転中')).toBeInTheDocument()
    expect(order).toEqual(['save:{"postsPerDay":2}', 'start'])
    // 保存し終えたので、「設定を保存する」は残らない。
    expect(screen.queryByRole('button', { name: '設定を保存する' })).not.toBeInTheDocument()
  })

  it('変えていなければ、保存を挟まずに始める', async () => {
    api.startAutopilot.mockResolvedValue({ state: withProfile({ enabled: true }) })
    render(<XAutopilotPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '自動運転を始める' }))
    expect(await screen.findByText('自動運転中')).toBeInTheDocument()
    expect(api.saveAutopilotSettings).not.toHaveBeenCalled()
  })

  it('試し書きも、変えた「文章の質」を先に保存してから書かせる', async () => {
    api.saveAutopilotSettings.mockResolvedValue({ state: withProfile({ settings: { ...DEFAULT_SETTINGS, quality: 'saver' } }) })
    api.previewAutopilotPost.mockResolvedValue({ state: withProfile(), preview: { text: '節約で書いた', problems: [] } })
    render(<XAutopilotPanel />)
    fireEvent.click(await screen.findByRole('radio', { name: /節約/ }))
    fireEvent.click(button(/試し書き/))
    expect(await screen.findByText('節約で書いた')).toBeInTheDocument()
    expect(api.saveAutopilotSettings).toHaveBeenCalledWith({ quality: 'saver' })
    expect(api.saveAutopilotSettings.mock.invocationCallOrder[0]).toBeLessThan(api.previewAutopilotPost.mock.invocationCallOrder[0])
  })

  it('保存は済んだのに、あとの操作が失敗したら、理由を出して状態を取り直す', async () => {
    api.saveAutopilotSettings.mockResolvedValue({ state: withProfile() })
    api.startAutopilot.mockRejectedValue(new XAutopilotError('Xと連携していません', 400))
    render(<XAutopilotPanel />)
    fireEvent.change(await screen.findByLabelText('1日の投稿数'), { target: { value: '2' } })
    const before = api.fetchAutopilot.mock.calls.length
    fireEvent.click(button('自動運転を始める'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Xと連携していません')
    await waitFor(() => expect(api.fetchAutopilot.mock.calls.length).toBeGreaterThan(before))
  })

  it('時間帯の終わりが始めより前なら、黙って既定に戻さず理由を出し、保存も開始も押せない', async () => {
    render(<XAutopilotPanel />)
    fireEvent.change(await screen.findByLabelText('投稿する時間帯（終わり）'), { target: { value: '07:00' } })
    expect(screen.getByRole('alert')).toHaveTextContent('1時間以上あけてください')
    expect(button('設定を保存する')).toBeDisabled()
    expect(button('自動運転を始める')).toBeDisabled()
    expect(button(/試し書き/)).toBeDisabled()
    expect(screen.queryByText(/予約は最大\d+本が並びます/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('投稿する時間帯（終わり）'), { target: { value: '23:00' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(button('自動運転を始める')).toBeEnabled()
  })

  it('時刻が空（入力の途中）でも、理由を出して止める', async () => {
    render(<XAutopilotPanel />)
    fireEvent.change(await screen.findByLabelText('投稿する時間帯（始め）'), { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('時刻を入力してください')
    expect(button('設定を保存する')).toBeDisabled()
  })

  it('時間帯が狭くて入りきらない回数は、入る回数を教えて止める', async () => {
    render(<XAutopilotPanel />)
    fireEvent.change(await screen.findByLabelText('投稿する時間帯（終わり）'), { target: { value: '10:00' } })
    fireEvent.change(screen.getByLabelText('1日の投稿数'), { target: { value: '5' } })
    expect(screen.getByRole('alert')).toHaveTextContent('1日4回までしか入りません')
    expect(button('設定を保存する')).toBeDisabled()
  })

  it('月の上限が範囲外なら、範囲を教えて止める', async () => {
    render(<XAutopilotPanel />)
    fireEvent.change(await screen.findByLabelText('月の使用額の上限（円）'), { target: { value: '100' } })
    expect(screen.getByRole('alert')).toHaveTextContent('300〜50,000円')
    expect(button('設定を保存する')).toBeDisabled()
  })

  it('時刻の地域と、日ごとにずらすことを伝え、並ぶ予約の最大本数を見せる', async () => {
    render(<XAutopilotPanel />)
    expect(await screen.findByText(/時刻は日本時間です/)).toBeInTheDocument()
    expect(screen.getByText(/日ごとに少しずらして決まります/)).toBeInTheDocument()
    expect(screen.getByText(/1日3回 × 2日先まで ＝ 予約は最大6本が並びます/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('1日の投稿数'), { target: { value: '2' } })
    expect(screen.getByText(/1日2回 × 2日先まで ＝ 予約は最大4本が並びます/)).toBeInTheDocument()
  })

  it('予約の時刻は、端末の時差ではなく設定の地域（日本時間）で見せる', async () => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile({ enabled: true }) })
    posts.list = [post('a', { scheduledAt: '2026-10-11T03:00:00.000Z' })] // 日本時間 12:00
    render(<XAutopilotPanel />)
    const item = within(await screen.findByRole('list')).getByRole('listitem')
    expect(item).toHaveTextContent('12:00')
  })
})

describe('XAutopilotPanel: 自動運転の開始・停止', () => {
  it('文体のまとめが無ければ始められない（案内を出す）', async () => {
    render(<XAutopilotPanel />)
    expect(await screen.findByRole('button', { name: '自動運転を始める' })).toBeDisabled()
    expect(screen.getByText(/先に、Xとの連携と「文体をまとめる」を済ませてください/)).toBeInTheDocument()
  })

  it('始めると ON になり、予約一覧を取り直す。始めるまで費用がかからないことも伝える', async () => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile() })
    api.startAutopilot.mockResolvedValue({ state: withProfile({ enabled: true }) })
    render(<XAutopilotPanel />)
    expect(await screen.findByText(/始めるまで、費用はかかりません/)).toBeInTheDocument()
    fireEvent.click(button('自動運転を始める'))
    expect(await screen.findByText('自動運転中')).toBeInTheDocument()
    expect(posts.reload).toHaveBeenCalled()
    expect(button('自動運転を止める')).toBeEnabled()
  })

  it('止めると、取り消した予約の件数を伝える', async () => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile({ enabled: true }) })
    api.stopAutopilot.mockResolvedValue({ state: withProfile({ enabled: false }), result: { canceled: 4 } })
    render(<XAutopilotPanel />)
    fireEvent.click(await screen.findByRole('button', { name: '自動運転を止める' }))
    expect(await screen.findByText(/まだ出ていない予約 4 件を取り消しました/)).toBeInTheDocument()
    expect(await screen.findByText('自動運転は止まっています')).toBeInTheDocument()
  })

  it('補充を止めている理由（月の上限など）を、動作中の表示に出す', async () => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile({ enabled: true, lastError: '今月の使用額の上限（3,000円）に達したため、新しい投稿を作っていません' }) })
    render(<XAutopilotPanel />)
    expect(await screen.findByText(/補充を止めています: 今月の使用額の上限/)).toBeInTheDocument()
  })

  it('操作の最中は、ほかの操作を押せない（費用が出る操作が重ならないように）', async () => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile() })
    let finish!: (v: unknown) => void
    api.previewAutopilotPost.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<XAutopilotPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /試し書き/ }))
    expect(await screen.findByRole('button', { name: '書いています…' })).toBeDisabled()
    expect(button('自動運転を始める')).toBeDisabled()
    expect(button(/新しい投稿だけ取り込む/)).toBeDisabled()
    finish({ state: withProfile(), preview: { text: '本文', problems: [] } })
    expect(await screen.findByText('本文')).toBeInTheDocument()
  })
})

describe('XAutopilotPanel: これから投稿される予定', () => {
  beforeEach(() => {
    api.fetchAutopilot.mockResolvedValue({ state: withProfile({ enabled: true }) })
  })

  it('自動運転の予約中だけを、時刻の早い順に出す（ふつうの予約・投稿済みは出さない）', async () => {
    posts.list = [
      post('b', { scheduledAt: '2026-10-11T09:00:00.000Z' }),
      post('a', { scheduledAt: '2026-10-11T03:00:00.000Z' }),
      post('x', { aiPrompt: undefined, segments: [{ text: 'ふつうの予約', media: [] }] }),
      post('p', { status: 'posted' }),
    ]
    render(<XAutopilotPanel />)
    const list = await screen.findByRole('list')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('自動運転の本文 a')
    expect(items[1]).toHaveTextContent('自動運転の本文 b')
    expect(screen.queryByText('ふつうの予約')).not.toBeInTheDocument()
  })

  it('取り消すと、その予約だけを消して一覧を取り直す', async () => {
    posts.list = [post('a'), post('b')]
    render(<XAutopilotPanel />)
    const [first] = await screen.findAllByRole('button', { name: /取り消す/ })
    fireEvent.click(first)
    await waitFor(() => expect(posts.remove).toHaveBeenCalledTimes(1))
    expect(posts.remove.mock.calls[0][0]).toMatchObject({ id: 'a' })
    expect(posts.reload).toHaveBeenCalled()
  })

  it('予約が無ければ、始めると並ぶことを伝える', async () => {
    render(<XAutopilotPanel />)
    expect(await screen.findByText(/まだありません。自動運転を始めると、ここに並びます/)).toBeInTheDocument()
  })
})

describe('XAutopilotPanel: 準備と失敗', () => {
  it('保存先の表（SQL 007）が無ければ、SQL の案内だけを出す', async () => {
    api.fetchAutopilot.mockRejectedValue(new XAutopilotError('準備がまだです', 503, true))
    render(<XAutopilotPanel />)
    expect(await screen.findByText('自動運転の保存先がまだ用意されていません')).toBeInTheDocument()
    expect(screen.getByText(/007_x_autopilot\.sql/)).toBeInTheDocument()
  })

  it('読み込みに失敗したら、理由ともう一度ためすボタン', async () => {
    api.fetchAutopilot.mockRejectedValue(new Error('サーバーに接続できません'))
    render(<XAutopilotPanel />)
    expect(await screen.findByText('サーバーに接続できません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /もう一度ためす/ })).toBeInTheDocument()
  })
})
