import JSZip from 'jszip'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function toYtdJs(kind, entries) {
  const records = entries.map((entry) => ({
    [kind]: {
      accountId: entry.accountId,
      userLink: `https://twitter.com/intent/user?user_id=${entry.accountId}`,
      ...(entry.username ? { username: entry.username } : {}),
    },
  }))
  return `window.YTD.${kind}.part0 = ${JSON.stringify(records, null, 0)}`
}

const followers = Array.from({ length: 100 }, (_, i) => ({
  accountId: String(i),
  username: `mutual_user_${i}`,
}))

const nonMutual = Array.from({ length: 30 }, (_, i) => ({
  accountId: String(200 + i),
  username: `nonmutual_user_${i}`,
}))

const following = [...followers, ...nonMutual]

const zip = new JSZip()
const dataDir = zip.folder('data')
dataDir.file('following.js', toYtdJs('following', following))
dataDir.file('follower.js', toYtdJs('follower', followers))

const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
await writeFile(path.join(__dirname, 'test-archive.zip'), buffer)
console.log('wrote', path.join(__dirname, 'test-archive.zip'), buffer.length, 'bytes')
