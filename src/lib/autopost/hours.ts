// 自動投稿の「文ごとの投稿する時間帯」。日本時間の「時」（0〜23）の集まりで持つ。9 は 9:00〜9:59。
// 選び分けそのもの（どの文を使うか）はサーバー側（api/_lib/autopostDoc.ts）でやる。ここは画面の表示と選び方だけ。

/** 時間帯。null は終日（いつでも）。空の配列は「まだ1つも選んでいない」書きかけで、保存はできない。 */
export type Hours = number[] | null

export const ALL_HOURS: number[] = Array.from({ length: 24 }, (_, i) => i)

/** ワンタップで選べる時間帯。細かい調整は、その後に1時間ずつ付け外しする。 */
export const HOUR_PRESETS: { label: string; hours: number[] }[] = [
  { label: '朝', hours: [5, 6, 7, 8, 9, 10] },
  { label: '昼', hours: [11, 12, 13, 14, 15, 16] },
  { label: '夕方', hours: [17, 18, 19, 20] },
  { label: '夜', hours: [21, 22, 23] },
  { label: '深夜', hours: [0, 1, 2, 3, 4] },
]

/** 1時間を付け外しする。24時間ぜんぶになったら終日（null）に戻す。 */
export function toggleHour(hours: Hours, hour: number): Hours {
  const current = hours ?? ALL_HOURS
  const next = current.includes(hour) ? current.filter((h) => h !== hour) : [...current, hour]
  const sorted = [...next].sort((a, b) => a - b)
  return sorted.length === 24 ? null : sorted
}

export function sameHours(a: Hours, b: Hours): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** 同じ時間帯か確かめるために、並びと重なりをそろえる。24時間ぜんぶは終日と同じ。 */
export function normalizeHours(hours: Hours): Hours {
  if (hours === null) return null
  const sorted = [...new Set(hours)].sort((a, b) => a - b)
  return sorted.length === 24 ? null : sorted
}

/**
 * 時間帯を一言で。つながった時間はまとめる（9〜12時 は 9:00〜12:00）。夜をまたぐものは「22時〜翌3時」。
 * 0時と23時がつながるときは、前日の夜からの続きとして1つにする。
 */
export function hoursLabel(hours: Hours): string {
  if (hours === null) return '終日'
  const sorted = [...new Set(hours)].sort((a, b) => a - b)
  if (sorted.length === 0) return '未選択'
  if (sorted.length === 24) return '終日'

  // つながった範囲 [開始, 終わり)（終わりは含まない）に分ける
  const runs: [number, number][] = []
  for (const h of sorted) {
    const last = runs[runs.length - 1]
    if (last && last[1] === h) last[1] = h + 1
    else runs.push([h, h + 1])
  }
  // 23時で終わる範囲と 0時から始まる範囲は、夜をまたいで1つにつながる
  if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === 24) {
    const head = runs.shift()!
    const tail = runs.pop()!
    runs.push([tail[0], head[1] + 24])
  }
  return runs
    .map(([from, to]) => {
      if (to - from === 1) return `${from}時台`
      return to > 24 ? `${from}時〜翌${to - 24}時` : `${from}〜${to}時`
    })
    .join('・')
}
