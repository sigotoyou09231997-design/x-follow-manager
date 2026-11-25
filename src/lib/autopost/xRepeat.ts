import { PRICE, USD_JPY } from '../xAutopilot/cost'

// X（くり返し）の間隔の言い方と、料金の目安（X API は投稿1件 $0.015）。

export function intervalLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}分おき`
  if (minutes === 1440) return '1日1回'
  return `${minutes / 60}時間おき`
}

/** 終日投稿したときの1日の本数と、月（30日）の X API の料金の目安（10円単位）。 */
export function estimate(minutes: number): { perDay: number; monthlyYen: number } {
  const perDay = Math.floor((24 * 60) / minutes)
  const monthlyYen = Math.round((perDay * 30 * PRICE.xPostUsd * USD_JPY) / 10) * 10
  return { perDay, monthlyYen }
}
