/**
 * 浏览器端抽取适配层入口。
 * 所有解析都在浏览器完成，服务端只接收已校对的结构化 JSON。
 */

import type { ExtractWarning, ExtractedDoc, FileKind } from './types.js'

export * from './types.js'
export { autoMapColumns, emptyColumnMap } from './xlsx.js'
export type { ColumnMap } from './xlsx.js'
export { decodeTextBuffer } from './text.js'

export function detectFileKind(fileName: string, mime?: string): FileKind {
  const lower = fileName.toLowerCase()
  const ext = lower.slice(lower.lastIndexOf('.') + 1)
  if (ext === 'docx' || ext === 'dotx') return 'docx'
  if (ext === 'doc') return 'doc-legacy'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') return 'xlsx'
  if (ext === 'csv') return 'csv'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'json') return 'json'
  if (ext === 'txt') return 'txt'
  if (mime?.includes('wordprocessingml')) return 'docx'
  if (mime?.includes('pdf')) return 'pdf'
  if (mime?.includes('spreadsheetml')) return 'xlsx'
  if (mime?.startsWith('text/')) return 'txt'
  return 'unknown'
}

export class ExtractError extends Error {
  constructor(
    public readonly fileName: string,
    public readonly step: string,
    reason: string,
  ) {
    super(`「${fileName}」在「${step}」阶段失败：${reason}`)
    this.name = 'ExtractError'
  }
}

/** 统一入口：按扩展名分派，任何失败都抛出可读原因（文件名 + 步骤 + 原因）。 */
export async function extractFile(file: File): Promise<ExtractedDoc> {
  const kind = detectFileKind(file.name, file.type)
  const warnings: ExtractWarning[] = []
  try {
    const run = async (): Promise<ExtractedDoc> => {
      switch (kind) {
        case 'docx': {
          const { extractDocx } = await import('./docx.js')
          return await extractDocx(file, warnings)
        }
        case 'pdf': {
          const { extractPdf } = await import('./pdf.js')
          return await extractPdf(file, warnings)
        }
        case 'xlsx':
        case 'csv': {
          const { extractTable } = await import('./xlsx.js')
          return await extractTable(file, kind, warnings)
        }
        case 'md':
        case 'txt': {
          const { extractPlainText } = await import('./text.js')
          return await extractPlainText(file, kind, warnings)
        }
        case 'json': {
          const { extractJson } = await import('./json.js')
          return await extractJson(file, warnings)
        }
        case 'doc-legacy':
          throw new ExtractError(file.name, '识别格式', '旧版 .doc 不支持，请另存为 .docx 后重试')
        default:
          break
      }
      throw new ExtractError(file.name, '识别格式', '不支持的文件类型，请使用 docx / pdf / xlsx / csv / txt / md / json')
    }
    const result = await run()
    // 各抽取器把警告写进局部数组，这里统一挂回 doc，UI 才能显示
    if (warnings.length > 0) result.warnings.unshift(...warnings)
    return result
  } catch (err) {
    if (err instanceof ExtractError) throw err
    throw new ExtractError(file.name, '抽取', err instanceof Error ? err.message : String(err))
  }
}
