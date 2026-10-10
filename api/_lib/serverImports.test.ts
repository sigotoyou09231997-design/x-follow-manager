// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// サーバー関数（api/*.ts）が読み込むファイルの「相対 import」は、拡張子 .js を付けて書く。
//
// Vercel は TypeScript を JavaScript に変換して動かし、そこでは Node の ESM の決まりが効く:
// 拡張子の無い相対 import（`from '../schedule/repeat'`）は ERR_MODULE_NOT_FOUND で落ちる。
// 一方、ブラウザ側のビルド（Vite）とテスト（vitest）は拡張子が無くても読めてしまうため、
// 手元の型検査・テスト・ビルドが全部通ったまま、本番だけが 500 になる（2026-10-10 に実際に起きた:
// src/lib/xAutopilot/slots.ts を共有部品にしたとき、publishDue ごと落ちて予約の投稿が止まった）。
// そこで、サーバーが読み込む範囲を実際にたどって、拡張子の無い相対 import を探す。

const ROOT = resolve(import.meta.dirname, '../..')

/** 値として読み込まれる相対 import / export-from の指定子。`import type` は変換で消えるので対象外。 */
function relativeValueImports(source: string): string[] {
  const found: string[] = []
  const pattern = /^\s*(?:import|export)\s+(type\s+)?([^;'"]*?\s+from\s+)?'(\.{1,2}\/[^']*)'/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) continue // import type / export type
    found.push(match[3])
  }
  return found
}

/** 指定子（.js つき）が指す TypeScript のファイル。 */
function toSource(from: string, specifier: string): string {
  return resolve(dirname(from), specifier.replace(/\.js$/, '.ts'))
}

function serverFiles(): { files: Set<string>; problems: string[] } {
  const entries = readdirSync(join(ROOT, 'api'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(ROOT, 'api', name))
  const files = new Set<string>()
  const problems: string[] = []
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    files.add(file)
    for (const specifier of relativeValueImports(readFileSync(file, 'utf8'))) {
      if (!/\.(js|json)$/.test(specifier)) {
        problems.push(`${relative(ROOT, file)}: '${specifier}' に拡張子 .js が付いていない`)
        continue
      }
      const target = toSource(file, specifier)
      if (!existsSync(target) && !specifier.endsWith('.json')) {
        problems.push(`${relative(ROOT, file)}: '${specifier}' の行き先（${relative(ROOT, target)}）が無い`)
        continue
      }
      if (specifier.endsWith('.js')) queue.push(target)
    }
  }
  return { files, problems }
}

// この検査ファイルを api/ の直下に置いてはいけない。api/ 直下の .ts は、テストも含めて全部「関数」として数えられ、
// Vercel の無料枠（Hobby）は12個まで（超えるとデプロイが丸ごと失敗する）。2026-10-10 に、直下へ置いた
// この検査ファイルが13個目になって、修正のデプロイが拒否された。api/_lib/ の中は数えられない。
describe('api/ 直下の関数の数', () => {
  it('api/ 直下の .ts（テストも含む）は12個まで。増やすなら api/_lib/ に置く', () => {
    const topLevel = readdirSync(join(ROOT, 'api')).filter((name) => name.endsWith('.ts') && !name.startsWith('_'))
    expect(topLevel.length, `api/ 直下: ${topLevel.join(', ')}`).toBeLessThanOrEqual(12)
  })
})

describe('サーバー関数が読み込むファイルの import', () => {
  it('相対 import は、すべて .js つきで、行き先のファイルがある', () => {
    const { problems } = serverFiles()
    expect(problems).toEqual([])
  })

  it('検査の対象に、api の受け口と、それが読む src/ の共有部品が入っている（検査が空振りしていない）', () => {
    const { files } = serverFiles()
    const names = [...files].map((f) => relative(ROOT, f))
    expect(names).toContain('api/publishDue.ts')
    expect(names).toContain('api/xAutopilot.ts')
    expect(names).toContain('api/_lib/autopilotEngine.ts')
    expect(names).toContain('src/lib/xAutopilot/slots.ts') // api が読む src/ の中も見る
    expect(names).toContain('src/lib/schedule/repeat.ts')
  })

  it('検出の書き方そのものが正しい（拡張子なし・type・複数行・export from）', () => {
    const source = [
      "import { a } from '../x/noext'",
      "import type { T } from '../x/typeonly'",
      "import { b } from '../x/ok.js'",
      "export { c } from './reexport'",
      "import {",
      '  d,',
      "} from './multi'",
      "import { z } from 'zod'",
    ].join('\n')
    expect(relativeValueImports(source)).toEqual(['../x/noext', '../x/ok.js', './reexport', './multi'])
  })
})
