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
 * 時間帯を一言で。つながった時間はまとめる（9時〜12時 は 9:00〜12:00）。夜をまたぐものは「22時〜翌3時」。
 * 離れた時間は「・」でつなぐ。1時間だけなら「9時台」。
 */
export function hoursLabel(hours: Hours): string {
  if (hours === null) return '終日'
  const sorted = [...new Set(hours)]
  if (sorted.length === 0) return '未選択'
  if (sorted.length === 24) return '終日'
  return hoursToRanges(sorted)
    .map((r) => (rangeHours(r).length === 1 ? `${r.from}時台` : rangeLabel(r)))
    .join('・')
}

/**
 * 「◯時から◯時まで」の1つぶん。from は含み、to は含まない（9→12 は 9:00〜11:59）。
 * to が from 以下なら、夜をまたぐ（22→6 は 22:00〜翌5:59）。to は 1〜24。
 */
export interface Range {
  from: number
  to: number
}

/** 範囲に含まれる「時」。from と to が同じ（24時間ぜんぶ）になる範囲は作れない前提。 */
export function rangeHours({ from, to }: Range): number[] {
  const out: number[] = []
  for (let h = from; h !== to % 24; h = (h + 1) % 24) {
    out.push(h)
    if (out.length === 24) break
  }
  return out
}

/** 範囲のあつまりを時間の集まりにする。重なりは1つにまとめ、24時間ぜんぶは終日（null）、範囲が無ければ空。 */
export function rangesToHours(ranges: Range[]): Hours {
  const all = new Set(ranges.flatMap(rangeHours))
  if (all.size === 24) return null
  return [...all].sort((a, b) => a - b)
}

/** 時間の集まりを、つながった範囲に分ける。0時と23時がつながるときは、夜をまたぐ1つの範囲にする。 */
export function hoursToRanges(hours: Hours): Range[] {
  if (hours === null) return []
  const sorted = [...new Set(hours)].sort((a, b) => a - b)
  const runs: Range[] = []
  for (const h of sorted) {
    const last = runs[runs.length - 1]
    if (last && last.to === h) last.to = h + 1
    else runs.push({ from: h, to: h + 1 })
  }
  if (runs.length > 1 && runs[0].from === 0 && runs[runs.length - 1].to === 24) {
    const head = runs.shift()!
    const tail = runs.pop()!
    runs.push({ from: tail.from, to: head.to })
  }
  return runs
}

/** 終了の時刻に選べる値。開始の次の時から、翌日の開始の1時間前まで（開始と同じ時は24時間ぜんぶになるので選べない）。 */
export function endChoices(from: number): { to: number; nextDay: boolean }[] {
  const out: { to: number; nextDay: boolean }[] = []
  for (let step = 1; step < 24; step++) {
    const to = ((from + step - 1) % 24) + 1 // 1〜24
    out.push({ to, nextDay: from + step > 24 })
  }
  return out
}

/** 「9時〜12時」「22時〜翌6時」。 */
export function rangeLabel({ from, to }: Range): string {
  return `${from}時〜${to <= from ? '翌' : ''}${to}時`
}

/**
 * 時間ごとに、いま使われる文（文の何番目か）。サーバー（api/_lib/autopostDoc.ts）の選び方と同じ:
 * 時間を決めた文が当たればそれだけ、無ければ時間を決めていない文、それも無ければ空（その時間は休む）。
 * Yay（oneOnly）は当たった文の先頭の1つだけ。1日の使われ方の図に使う。
 */
export function ownersByHour(hours: Hours[], oneOnly: boolean): number[][] {
  return ALL_HOURS.map((hour) => {
    const timed = hours.flatMap((h, i) => (h?.includes(hour) ? [i] : []))
    const active = timed.length > 0 ? timed : hours.flatMap((h, i) => (h === null ? [i] : []))
    return oneOnly ? active.slice(0, 1) : active
  })
}

export interface Segment {
  /** 開始の時と、時間の数。 */
  from: number
  length: number
  /** 使われる文（文の何番目か）。空なら休み。 */
  owners: number[]
}

/** 1日を、同じ文が使われている連続した時間ごとに区切る。 */
export function daySegments(owners: number[][]): Segment[] {
  const segments: Segment[] = []
  owners.forEach((o, hour) => {
    const last = segments[segments.length - 1]
    if (last && JSON.stringify(last.owners) === JSON.stringify(o)) last.length++
    else segments.push({ from: hour, length: 1, owners: o })
  })
  return segments
}

/**
 * 1日を、同じ文が使われている連続した時間ごとに区切る。0時をまたいで同じ文が続くとき（22時〜翌5時など）は1つにまとめる。
 * 並びは「開始の時刻」の小さい順。まとめた区間は、夜の開始の時刻（22時）の位置に来る。
 */
export function circularSegments(owners: number[][]): Segment[] {
  const segments = daySegments(owners)
  if (segments.length > 1) {
    const first = segments[0]
    const last = segments[segments.length - 1]
    if (JSON.stringify(first.owners) === JSON.stringify(last.owners)) {
      segments.shift()
      last.length += first.length
    }
  }
  return segments
}

/** いまの「時」が、この区間に入っているか。夜をまたぐ区間も扱う。 */
export function segmentHas(seg: Segment, hour: number): boolean {
  return (hour - seg.from + 24) % 24 < seg.length
}

/** 区間の時間帯の表示。「9時〜20時」「22時〜翌5時」。丸1日なら「終日」。 */
export function segmentLabel(seg: Segment): string {
  if (seg.length >= 24) return '終日'
  return rangeLabel({ from: seg.from, to: ((seg.from + seg.length - 1) % 24) + 1 })
}
