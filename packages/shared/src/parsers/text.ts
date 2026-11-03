import type { ExtractWarning, ExtractedDoc, FileKind } from './types.js'
import { finalizeDoc, makeDoc } from './types.js'

/** 编码自动识别：先按 UTF-8 严格解码，失败回退 GBK。 */
export function decodeTextBuffer(buffer: ArrayBuffer): { text: string; encoding: 'utf-8' | 'gbk' } {
  const bytes = new Uint8Array(buffer)
  const hasUtf16Bom = bytes[0] === 0xff && bytes[1] === 0xfe
  const hasUtf16BeBom = bytes[0] === 0xfe && bytes[1] === 0xff
  if (hasUtf16Bom || hasUtf16BeBom) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-8' }
  }
  const hasUtf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const slice = hasUtf8Bom ? bytes.subarray(3) : bytes
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(slice), encoding: 'utf-8' }
  } catch {
    try {
      return { text: new TextDecoder('gbk').decode(slice), encoding: 'gbk' }
    } catch {
      return { text: new TextDecoder('utf-8').decode(slice), encoding: 'utf-8' }
    }
  }
}

export async function extractPlainText(
  file: File,
  kind: FileKind,
  warnings: ExtractWarning[],
): Promise<ExtractedDoc> {
  const buffer = await file.arrayBuffer()
  const { text, encoding } = decodeTextBuffer(buffer)
  if (encoding === 'gbk') {
    warnings.push({ code: 'encoding', message: '文件按 GBK 解码，请抽查中文是否正常' })
  }
  const doc = makeDoc(kind, file.name)
  const normalized = text.replace(/\r\n?/g, '\n')
  doc.text = kind === 'md' ? stripFrontMatter(normalized) : normalized
  doc.pageTexts = [doc.text]
  if (kind === 'md') {
    doc.headings = [...doc.text.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({
      level: (m[1] ?? '#').length,
      text: (m[2] ?? '').trim(),
    }))
  }
  if (doc.text.replace(/\s/g, '').length === 0) {
    warnings.push({ code: 'empty-text', message: '文件没有可读文本内容' })
  }
  return finalizeDoc(doc)
}

function stripFrontMatter(text: string): string {
  if (!text.startsWith('---')) return text
  const end = text.indexOf('\n---', 3)
  return end === -1 ? text : text.slice(end + 4).replace(/^\n+/, '')
}
