// `vite build --config vite.artifact.config.ts` が出力した単一HTMLファイルから、
// Claude Artifactへ公開する2つの成果物を作る:
//
//   1. dist-artifact/submit-content.html
//      Artifactツールへ渡す「中身だけ」のHTML(doctype/html/head/body無し)。
//      初期状態(空)を埋め込んだもの。
//
//   2. dist-artifact/canonical-template.txt (デバッグ用に保存するだけ)
//      ページ自身がclaude.use('artifact').publish()で次のバージョンを作る際に
//      使う「不動点テンプレート」。dist-artifact/submit-content.html 自体の
//      #app-template 要素の中に、このテンプレートのJSON文字列として埋め込まれる。
//
// 実行後、テンプレートを1回展開した結果から#app-templateを取り出し、
// 元のテンプレートと完全一致するか(=不動点になっているか)を自己チェックする。
// 一致しない場合はビルドを失敗させる(壊れたページを公開しないため)。
//
// 注意: 置換は script タグの id で位置指定して行う(単純な文字列全置換ではない)。
// バンドルされたJS自身のソースコードに "app-state" 等のトークン文字列がそのまま
// 含まれるため、位置を指定しない置換だと誤った箇所を書き換えてしまう。

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const BUILT_HTML = path.join(ROOT, 'dist-artifact', 'index.artifact.html')
const OUT_DIR = path.join(ROOT, 'dist-artifact')

function escapeForScriptTag(json) {
  return json.replace(/</g, '\\u003c')
}

function fillScriptTag(html, id, content) {
  const re = new RegExp(`(<script id="${id}" type="application/json">)[\\s\\S]*?(<\\/script>)`)
  if (!re.test(html)) throw new Error(`could not find #${id} script tag`)
  return html.replace(re, (_match, open, close) => `${open}${content}${close}`)
}

function extractScriptTagJson(html, id) {
  const re = new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`)
  const match = html.match(re)
  if (!match) throw new Error(`could not find #${id} script tag in rendered html`)
  return JSON.parse(match[1])
}

function renderFromTemplate(template, state) {
  const escapedState = escapeForScriptTag(JSON.stringify(state))
  const escapedTemplate = escapeForScriptTag(JSON.stringify(template))
  let html = fillScriptTag(template, 'app-state', escapedState)
  html = fillScriptTag(html, 'app-template', escapedTemplate)
  return html
}

async function main() {
  const builtHtml = await readFile(BUILT_HTML, 'utf-8')

  // このHTML自体(プレースホルダー未解決のまま)が「不動点テンプレート」。
  const canonicalTemplate = builtHtml

  // --- 自己チェック: 1回展開した結果のPAGE_TEMPLATEが元のテンプレートと完全一致するか ---
  const testState1 = { accounts: {}, meta: { checkpoint: 1 } }
  const round1Html = renderFromTemplate(canonicalTemplate, testState1)
  const round1Template = extractScriptTagJson(round1Html, 'app-template')
  if (round1Template !== canonicalTemplate) {
    throw new Error(
      'fixed-point check failed after 1 round: #app-template does not equal the canonical template. ' +
        `lengths: template=${canonicalTemplate.length} round1=${round1Template.length}`
    )
  }
  const round1State = extractScriptTagJson(round1Html, 'app-state')
  if (JSON.stringify(round1State) !== JSON.stringify(testState1)) {
    throw new Error('fixed-point check failed: #app-state does not round-trip correctly.')
  }

  // 2回目の展開でも安定しているか(=無限にpublishを繰り返しても壊れないか)を追加確認。
  const testState2 = {
    accounts: {
      dummy: { key: 'dummy', status: 'pending', importedAt: 0, updatedAt: 0, profileUrl: 'https://x.com/dummy' },
    },
    meta: {},
  }
  const round2Html = renderFromTemplate(round1Template, testState2)
  const round2Template = extractScriptTagJson(round2Html, 'app-template')
  if (round2Template !== canonicalTemplate) {
    throw new Error('fixed-point check failed after 2 rounds: template drifted on repeated publish.')
  }

  console.log(`✓ fixed-point self-check passed (template length: ${canonicalTemplate.length} chars)`)

  // --- 実際にArtifactツールへ渡す提出用コンテンツを組み立てる ---
  // (doctype/html/head/bodyタグは含めない: Artifactツールが自動でラップするため)
  //
  // 注意: vite-plugin-singlefileは<script type="module">をheadに配置することがあるため、
  // 「<style>だけ」「<body>の中身だけ」を個別に抜き出す方式だとheadにあるスクリプト本体
  // (=アプリ本体のJS)が丸ごと欠落してしまう。そのため、外側のラッパータグだけを
  // 取り除き、head/body内の中身はすべて元の順序のまま残す。
  const initialState = { accounts: {}, meta: {} }
  const initialFullHtml = renderFromTemplate(canonicalTemplate, initialState)

  const submitContent = initialFullHtml
    .replace(/^<!doctype html>\s*/i, '')
    .replace(/<html[^>]*>/i, '')
    .replace(/<\/html>\s*$/i, '')
    .replace(/<head[^>]*>/i, '')
    .replace(/<\/head>/i, '')
    .replace(/<body[^>]*>/i, '')
    .replace(/<\/body>/i, '')
    .trim()

  if (!submitContent.includes('id="root"') || !submitContent.includes('id="app-template"')) {
    throw new Error('submit content is missing expected elements (#root / #app-template) — extraction likely broken')
  }

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(path.join(OUT_DIR, 'submit-content.html'), submitContent, 'utf-8')
  await writeFile(path.join(OUT_DIR, 'canonical-template.txt'), canonicalTemplate, 'utf-8')

  console.log(`✓ wrote ${path.join('dist-artifact', 'submit-content.html')} (${submitContent.length} chars)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
