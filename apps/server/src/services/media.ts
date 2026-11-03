import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db/index.js'
import { MEDIA_ALLOWED_MIME, MEDIA_MAX_BYTES } from '@kaoshiya/shared'
import type { QuestionMedia } from '@kaoshiya/shared'
import { badRequest, payloadTooLarge } from '../errors.js'
import { sha256Hex } from '../util.js'

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function sniffMime(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  )
    return 'image/png'
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp'
  return null
}

export function saveMedia(mediaDir: string, buffer: Buffer, fileName: string): QuestionMedia {
  if (buffer.length === 0) throw badRequest('图片内容为空')
  if (buffer.length > MEDIA_MAX_BYTES) throw payloadTooLarge('单张图片不能超过 2 MB')
  const mime = sniffMime(buffer)
  if (!mime || !MEDIA_ALLOWED_MIME.includes(mime as (typeof MEDIA_ALLOWED_MIME)[number])) {
    throw badRequest('仅支持 jpg / png / webp 图片')
  }
  const hash = sha256Hex(buffer)
  const ext = EXT[mime] ?? 'bin'
  const target = path.join(mediaDir, `${hash}.${ext}`)
  fs.mkdirSync(mediaDir, { recursive: true })
  if (!fs.existsSync(target)) fs.writeFileSync(target, buffer)
  return { hash, name: fileName.slice(0, 120), mime, size: buffer.length }
}

export function mediaFileName(media: QuestionMedia): string {
  return `${media.hash}.${EXT[media.mime] ?? 'bin'}`
}

export function listReferencedHashes(db: Db): Set<string> {
  const rows = db.prepare('SELECT media FROM questions').all() as { media: string }[]
  const set = new Set<string>()
  for (const row of rows) {
    try {
      const list = JSON.parse(row.media) as QuestionMedia[]
      for (const item of list) if (item?.hash) set.add(item.hash)
    } catch {
      // 损坏的媒体字段跳过
    }
  }
  return set
}

/**
 * 媒体只删除不再被任何题库引用的文件。
 * 调用方已在题库删除事务提交后传入候选 hash。
 */
export function deleteUnreferencedMedia(db: Db, dir: string, candidates: readonly string[]): number {
  if (candidates.length === 0) return 0
  const referenced = listReferencedHashes(db)
  let removed = 0
  for (const hash of new Set(candidates)) {
    if (referenced.has(hash)) continue
    for (const ext of Object.values(EXT)) {
      const file = path.join(dir, `${hash}.${ext}`)
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
        removed += 1
      }
    }
  }
  return removed
}

export function mediaSize(dir: string): { bytes: number; files: number } {
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0 }
  let bytes = 0
  let files = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const stat = fs.statSync(path.join(dir, entry.name))
    bytes += stat.size
    files += 1
  }
  return { bytes, files }
}
