import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyUsage } from '../../lib/xAutopilot/types'
import { UsageMeter, usagePercent } from './UsageMeter'

afterEach(cleanup)

const usage = (yen: number, month = '2026-10') => ({ ...emptyUsage(month), yen })

describe('usagePercent', () => {
  it('上限に対する割合。0〜100に収める。上限が無ければ0', () => {
    expect(usagePercent(300, 3000)).toBe(10)
    expect(usagePercent(214, 3000)).toBe(7)
    expect(usagePercent(5000, 3000)).toBe(100)
    expect(usagePercent(-5, 3000)).toBe(0)
    expect(usagePercent(100, 0)).toBe(0)
  })
})

describe('UsageMeter（今月のAI料金）', () => {
  it('月・使った金額・上限・割合を出し、棒の長さは割合に合わせる', () => {
    render(<UsageMeter usage={usage(214)} budgetYen={3000} />)
    expect(screen.getByText('10月のAI料金（見積もり）')).toBeInTheDocument()
    expect(screen.getByText('214円')).toBeInTheDocument()
    expect(screen.getByText('／ 上限 3,000円')).toBeInTheDocument()
    expect(screen.getByText('7%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '7')
    expect(screen.getByRole('region', { name: '今月のAI料金' })).toHaveClass('usage-meter--ok')
  })

  it('8割を超えたら注意、上限に達したら止まることを伝える', () => {
    const { rerender } = render(<UsageMeter usage={usage(2500)} budgetYen={3000} />)
    expect(screen.getByRole('region', { name: '今月のAI料金' })).toHaveClass('usage-meter--warn')
    expect(screen.getByText(/もうすぐ上限です/)).toBeInTheDocument()

    rerender(<UsageMeter usage={usage(3200)} budgetYen={3000} />)
    expect(screen.getByRole('region', { name: '今月のAI料金' })).toHaveClass('usage-meter--over')
    expect(screen.getByText(/上限に達しました。来月まで/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('月が空なら「今月」と出す', () => {
    render(<UsageMeter usage={usage(0, '')} budgetYen={3000} />)
    expect(screen.getByText('今月のAI料金（見積もり）')).toBeInTheDocument()
  })
})
