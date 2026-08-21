// 数GB規模のXアーカイブZIP（動画・画像等のメディアを含む）を、ファイル全体を
// メモリに読み込むことなく解析するための最小限のZIP central directoryリーダー。
// following.js / follower.js のような数MB規模の対象ファイルだけを、オフセット指定の
// 部分読み込み（Blob.slice / ArrayBufferのsubarray）で取り出す。
// 圧縮方式がdeflateの場合はブラウザ/Node標準のDecompressionStreamで展開するため、
// 追加の解凍ライブラリには依存しない。

export type ZipSource = File | Blob | ArrayBuffer | Uint8Array

export interface ZipEntry {
  name: string
  compressionMethod: number
  compressedSize: number
  localHeaderOffset: number
}

interface RangeReader {
  size: number
  read(offset: number, length: number): Promise<Uint8Array>
}

const EOCD_SIGNATURE = 0x06054b50
const EOCD_FIXED_SIZE = 22
const MAX_COMMENT_SIZE = 65535
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_LOCATOR_SIZE = 20
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP64_EXTRA_ID = 0x0001
const MAX_UINT16 = 0xffff
const MAX_UINT32 = 0xffffffff

function u16(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8)
}

function u32(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0
}

function u64(buf: Uint8Array, off: number): number {
  return u32(buf, off) + u32(buf, off + 4) * 0x100000000
}

function toRangeReader(source: ZipSource): RangeReader {
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    const view =
      source instanceof ArrayBuffer
        ? new Uint8Array(source)
        : new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    return {
      size: view.byteLength,
      async read(offset, length) {
        return view.subarray(offset, Math.min(offset + length, view.byteLength))
      },
    }
  }

  const blob = source
  return {
    size: blob.size,
    async read(offset, length) {
      const buffer = await blob.slice(offset, offset + length).arrayBuffer()
      return new Uint8Array(buffer)
    },
  }
}

interface EndOfCentralDirectory {
  entryCount: number
  centralDirectorySize: number
  centralDirectoryOffset: number
}

async function findEndOfCentralDirectory(reader: RangeReader): Promise<EndOfCentralDirectory> {
  const tailSize = Math.min(reader.size, EOCD_FIXED_SIZE + MAX_COMMENT_SIZE)
  const tailOffset = reader.size - tailSize
  const tail = await reader.read(tailOffset, tailSize)

  let eocdPos = -1
  for (let i = tail.length - EOCD_FIXED_SIZE; i >= 0; i--) {
    if (u32(tail, i) === EOCD_SIGNATURE) {
      eocdPos = i
      break
    }
  }
  if (eocdPos === -1) {
    throw new Error('ZIPファイルの終端レコード(EOCD)が見つかりません。ファイルが破損しているか、ZIP形式ではありません。')
  }

  let entryCount = u16(tail, eocdPos + 10)
  let centralDirectorySize = u32(tail, eocdPos + 12)
  let centralDirectoryOffset = u32(tail, eocdPos + 16)

  const needsZip64 =
    entryCount === MAX_UINT16 || centralDirectorySize === MAX_UINT32 || centralDirectoryOffset === MAX_UINT32
  if (needsZip64) {
    const eocdOffsetInFile = tailOffset + eocdPos
    const locatorOffset = eocdOffsetInFile - ZIP64_EOCD_LOCATOR_SIZE
    const locator = await reader.read(locatorOffset, ZIP64_EOCD_LOCATOR_SIZE)
    if (u32(locator, 0) !== ZIP64_EOCD_LOCATOR_SIGNATURE) {
      throw new Error('ZIP64形式の終端レコードが見つかりません。ファイルが破損している可能性があります。')
    }
    const zip64EocdOffset = u64(locator, 8)
    const zip64Eocd = await reader.read(zip64EocdOffset, 56)
    if (u32(zip64Eocd, 0) !== ZIP64_EOCD_SIGNATURE) {
      throw new Error('ZIP64形式の終端レコードの解析に失敗しました。')
    }
    entryCount = u64(zip64Eocd, 32)
    centralDirectorySize = u64(zip64Eocd, 40)
    centralDirectoryOffset = u64(zip64Eocd, 48)
  }

  return { entryCount, centralDirectorySize, centralDirectoryOffset }
}

function readZip64ExtraOverrides(
  extra: Uint8Array,
  needs: { uncompressedSize: boolean; compressedSize: boolean; localHeaderOffset: boolean },
): { compressedSize?: number; localHeaderOffset?: number } {
  let pos = 0
  while (pos + 4 <= extra.length) {
    const id = u16(extra, pos)
    const size = u16(extra, pos + 2)
    if (id === ZIP64_EXTRA_ID) {
      let p = pos + 4
      let compressedSize: number | undefined
      let localHeaderOffset: number | undefined
      if (needs.uncompressedSize) p += 8
      if (needs.compressedSize) {
        compressedSize = u64(extra, p)
        p += 8
      }
      if (needs.localHeaderOffset) {
        localHeaderOffset = u64(extra, p)
        p += 8
      }
      return { compressedSize, localHeaderOffset }
    }
    pos += 4 + size
  }
  return {}
}

async function readCentralDirectoryEntries(
  reader: RangeReader,
  eocd: EndOfCentralDirectory,
): Promise<ZipEntry[]> {
  const buf = await reader.read(eocd.centralDirectoryOffset, eocd.centralDirectorySize)
  const entries: ZipEntry[] = []
  let pos = 0

  while (pos + 46 <= buf.length && u32(buf, pos) === CENTRAL_DIRECTORY_SIGNATURE) {
    const compressionMethod = u16(buf, pos + 10)
    const uncompressedSizeRaw = u32(buf, pos + 24)
    const compressedSizeRaw = u32(buf, pos + 20)
    const nameLen = u16(buf, pos + 28)
    const extraLen = u16(buf, pos + 30)
    const commentLen = u16(buf, pos + 32)
    const localHeaderOffsetRaw = u32(buf, pos + 42)

    const nameStart = pos + 46
    const name = new TextDecoder('utf-8').decode(buf.subarray(nameStart, nameStart + nameLen))

    let compressedSize = compressedSizeRaw
    let localHeaderOffset = localHeaderOffsetRaw
    const needsOverride =
      compressedSizeRaw === MAX_UINT32 || localHeaderOffsetRaw === MAX_UINT32 || uncompressedSizeRaw === MAX_UINT32
    if (needsOverride) {
      const extraStart = nameStart + nameLen
      const extra = buf.subarray(extraStart, extraStart + extraLen)
      const overrides = readZip64ExtraOverrides(extra, {
        uncompressedSize: uncompressedSizeRaw === MAX_UINT32,
        compressedSize: compressedSizeRaw === MAX_UINT32,
        localHeaderOffset: localHeaderOffsetRaw === MAX_UINT32,
      })
      if (overrides.compressedSize !== undefined) compressedSize = overrides.compressedSize
      if (overrides.localHeaderOffset !== undefined) localHeaderOffset = overrides.localHeaderOffset
    }

    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset })
    pos = nameStart + nameLen + extraLen + commentLen
  }

  return entries
}

export interface OpenedZip {
  entries: ZipEntry[]
  readEntryText(entry: ZipEntry): Promise<string>
}

export async function openZip(source: ZipSource): Promise<OpenedZip> {
  const reader = toRangeReader(source)
  const eocd = await findEndOfCentralDirectory(reader)
  const entries = await readCentralDirectoryEntries(reader, eocd)

  return {
    entries,
    async readEntryText(entry: ZipEntry): Promise<string> {
      const header = await reader.read(entry.localHeaderOffset, 30)
      if (u32(header, 0) !== LOCAL_FILE_HEADER_SIGNATURE) {
        throw new Error(`ローカルファイルヘッダーが不正です: ${entry.name}`)
      }
      const nameLen = u16(header, 26)
      const extraLen = u16(header, 28)
      const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen

      const compressed = await reader.read(dataStart, entry.compressedSize)

      let bytes: Uint8Array
      if (entry.compressionMethod === 0) {
        bytes = compressed
      } else if (entry.compressionMethod === 8) {
        const owned = new Uint8Array(compressed.byteLength)
        owned.set(compressed)
        const raw = new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(controller) {
            controller.enqueue(owned)
            controller.close()
          },
        })
        const stream = raw.pipeThrough(new DecompressionStream('deflate-raw'))
        bytes = new Uint8Array(await new Response(stream).arrayBuffer())
      } else {
        throw new Error(`未対応の圧縮方式です(method=${entry.compressionMethod}): ${entry.name}`)
      }

      return new TextDecoder('utf-8').decode(bytes)
    },
  }
}
