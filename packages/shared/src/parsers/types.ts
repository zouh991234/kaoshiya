export type FileKind = 'docx' | 'doc-legacy' | 'pdf' | 'xlsx' | 'csv' | 'md' | 'txt' | 'json' | 'unknown'

import type { ImportQuestionInput } from '../types.js'

export interface ExtractWarning {
  code: 'scanned-pdf' | 'empty-text' | 'no-table' | 'encoding' | 'truncated' | 'merged-cells'
  message: string
}

export interface TableBlock {
  sheet: string
  headers: string[]
  rows: string[][]
}

export interface HeadingItem {
  level: number
  text: string
}

export interface ExtractedDoc {
  kind: FileKind
  fileName: string
  text: string
  pageTexts: string[]
  tables: TableBlock[]
  headings: HeadingItem[]
  warnings: ExtractWarning[]
  scanned: boolean
  stats: { chars: number; pages: number; sheets: number }
  /** JSON 来源可直接给出结构化题目，跳过正则切题（保持高保真）。 */
  direct: ImportQuestionInput[] | null
}

export function makeDoc(kind: FileKind, fileName: string): ExtractedDoc {
  return {
    kind,
    fileName,
    text: '',
    pageTexts: [],
    tables: [],
    headings: [],
    warnings: [],
    scanned: false,
    stats: { chars: 0, pages: 0, sheets: 0 },
    direct: null,
  }
}

export function finalizeDoc(doc: ExtractedDoc): ExtractedDoc {
  doc.stats.chars = doc.text.replace(/\s/g, '').length
  doc.stats.pages = doc.pageTexts.length
  doc.stats.sheets = doc.tables.length
  return doc
}

/**
 * 扫描件判定：文本页数覆盖不足或平均每页字符数过低。
 * 必须显式判定并提示，绝不静默产出空题库。
 */
export function looksScanned(pageTexts: readonly string[]): boolean {
  if (pageTexts.length === 0) return false
  const perPage = pageTexts.map((t) => t.replace(/\s/g, '').length)
  const emptyPages = perPage.filter((n) => n < 10).length
  const total = perPage.reduce((a, b) => a + b, 0)
  const avg = total / perPage.length
  return avg < 40 || emptyPages / pageTexts.length > 0.6
}
