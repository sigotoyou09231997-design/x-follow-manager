/** 上限に対する使った割合（0〜100。上限が0以下なら0）。 */
export function usagePercent(yen: number, budgetYen: number): number {
  if (!(budgetYen > 0)) return 0
  return Math.min(100, Math.max(0, Math.round((yen / budgetYen) * 100)))
}
