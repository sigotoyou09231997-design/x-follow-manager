import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RejectedInsights } from './RejectedInsights'

afterEach(cleanup)

const rejected = [
  '焼き芋の匂いがした。',
  '焼き芋を買って帰った。',
  '駅前で焼き芋が売っていた。',
  'ハイボールが一番うまい。',
  'ハイボールの缶を常備してる。',
  '仕事終わりのビールが楽しみ。',
]

describe('RejectedInsights（取り消した文の分析）', () => {
  it('取り消した件数と、よく取り消される言葉・話題を、回数つきで出す。使わない言葉は印を付ける', () => {
    render(<RejectedInsights rejected={rejected} kept={['傘って安心する。']} />)
    const card = screen.getByRole('region', { name: '取り消した文の分析' })
    expect(within(card).getByText('6件')).toBeInTheDocument()
    expect(within(card).getByText('焼き芋')).toBeInTheDocument()
    expect(within(card).getByText('取り消し3回')).toBeInTheDocument()
    expect(within(card).getByText('ハイボール')).toBeInTheDocument()
    expect(within(card).getByText('お酒・晩酌')).toBeInTheDocument()
    expect(within(card).getByText(/濃い色の言葉は、使いません/)).toBeInTheDocument()
    // 3回取り消しの「焼き芋」は使わない言葉（印あり）、2回の「ハイボール」は印なし
    expect(within(card).getByText('焼き芋').closest('li')).toHaveClass('rejected-insights__chip--blocked')
    expect(within(card).getByText('ハイボール').closest('li')).not.toHaveClass('rejected-insights__chip--blocked')
  })

  it('取り消した文が無ければ、その旨を出す', () => {
    render(<RejectedInsights rejected={[]} kept={[]} />)
    expect(screen.getByText(/まだ取り消した文はありません/)).toBeInTheDocument()
  })

  it('取り消しはあっても、同じ言葉の偏りが無ければ、そう伝える', () => {
    render(<RejectedInsights rejected={['傘を忘れた。', '電車が遅れた。']} kept={[]} />)
    expect(screen.getByText(/同じ言葉が何度も取り消されている、という偏りは、まだありません/)).toBeInTheDocument()
  })
})
