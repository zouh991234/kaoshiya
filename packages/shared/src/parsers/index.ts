/**
 * 浏览器端抽取适配层入口。
 * 所有解析都在浏览器完成，服务端只接收已校对的结构化 JSON。
 */

import type { ExtractWarning, ExtractedDoc, FileKind } from './types.js'
import { extractDocx } from './docx.js'
import { extractPdf } from './pdf.js'
import { extractTable } from './xlsx.js'
import { extractPlainText } from './text.js'
import { extractJson } from './json.js'

export * from './types.js'
export { extractDocx } from './docx.js'
export { extractPdf } from './pdf.js'
export { extractTable, autoMapColumns } from './xlsx.js'
export { extractPlainText, decodeTextBuffer } from './text.js'
export { extractJson } from './json.js'

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
    switch (kind) {
      case 'docx':
        return await extractDocx(file, warnings)
      case 'pdf':
        return await extractPdf(file, warnings)
      case 'xlsx':
      case 'csv':
        return await extractTable(file, kind, warnings)
      case 'md':
      case 'txt':
        return await extractPlainText(file, kind, warnings)
      case 'json':
        return await extractJson(file, warnings)
      case 'doc-legacy':
        throw new ExtractError(file.name, '识别格式', '旧版 .doc 不支持，请另存为 .docx 后重试')
      default:
        throw new ExtractError(file.name, '识别格式', '不支持的文件类型，请使用 docx / pdf / xlsx / csv / txt / md / json')
    }
  } catch (err) {
    if (err instanceof ExtractError) throw err
    throw new ExtractError(file.name, '抽取', err instanceof Error ? err.message : String(err))
  }
}
