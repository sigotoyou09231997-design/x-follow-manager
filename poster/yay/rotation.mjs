// 1周で投稿するサークルを、順番に回す。
//
// 参加しているサークルが増えると、1周の投稿（と、その前後の画面の読み込み）が増える。Yay の画面は開くたびに
// 同じ初期化の通信を十数本出すので、13サークルだと約128件/分になり、このMacの回線に Yay の回数制限（429）がかかって、
// 同じ Wi-Fi のスマホの Yay まで「サーバーが不安定です」になった（2026-11-03）。
// そこで、サークルは減らさず、1周に出す数（perCycle）を決めて、周回ごとに順番にずらす。
// 1つのサークルへの投稿の間隔は伸びるが、そのぶん、前の投稿が長く残る（消して出し直すまでの時間が延びる）。
//
// タイムライン（'timeline'）は、サークルとは別に、毎周回かならず出す。

/**
 * @param {string[]} targets  'timeline' と 'group:…' の並び
 * @param {number|null|undefined} perCycle  1周に出すサークルの数。未設定・サークル数以上なら全部
 * @param {number} offset  前回の続き（周回ごとに進める）
 * @returns {{ picked: string[], nextOffset: number }}
 */
export function pickCycleTargets(targets, perCycle, offset = 0) {
  const circles = targets.filter((t) => t !== "timeline");
  const timeline = targets.filter((t) => t === "timeline");
  const n = Number(perCycle);
  if (!Number.isFinite(n) || n < 1 || n >= circles.length) return { picked: [...targets], nextOffset: 0 };
  const start = ((offset % circles.length) + circles.length) % circles.length;
  const chosen = Array.from({ length: n }, (_, i) => circles[(start + i) % circles.length]);
  return { picked: [...timeline, ...chosen], nextOffset: (start + n) % circles.length };
}
