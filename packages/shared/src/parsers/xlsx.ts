import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import type { ExtractWarning, ExtractedDoc, FileKind, TableBlock } from './types.js'
import { finalizeDoc, makeDoc } from './types.js'
import { decodeTextBuffer } from './text.js'

export interface ColumnMap {
  stem: number
  answer: number
  explanation: number
  chapter: number
  difficulty: number
  type: number
  options: Record<string, number>
}

export function emptyColumnMap(): ColumnMap {
  return { stem: -1, answer: -1, explanation: -1, chapter: -1, difficulty: -1, type: -1, options: {} }
}

const KEYWORDS: { field: keyof Omit<ColumnMap, 'options'>; words: string[] }[] = [
  { field: 'stem', words: ['题干', '题目', '问题', '试题', 'stem', 'question'] },
  { field: 'answer', words: ['答案', '正确答案', 'answer', 'key'] },
  { field: 'explanation', words: ['解析', '答案解析', '说明', '分析', 'explanation', 'analysis'] },
  { field: 'chapter', words: ['章节', '章', '分类', '知识点', 'chapter', 'section', 'category'] },
  { field: 'difficulty', words: ['难度', 'difficulty', 'level'] },
  { field: 'type', words: ['题型', '类型', 'type'] },
]

/** 表头自动映射：识别题干 / 选项 A~H / 答案 / 解析 / 章节 / 难度 / 题型。 */
export function autoMapColumns(headers: readonly string[]): ColumnMap {
  const map = emptyColumnMap()
  headers.forEach((raw, index) => {
    const head = raw.replace(/\s+/g, '').toLowerCase()
    if (!head) return
    const optionKey = head.match(/^(?:选项)?([a-h])(?:选项)?$/i) ?? head.match(/^选项([a-h])$/i)
    if (optionKey) {
      map.options[(optionKey[1] ?? 'A').toUpperCase()] = index
      return
    }
    for (const rule of KEYWORDS) {
      if (map[rule.field] !== -1) continue
      if (rule.words.some((word) => head.includes(word.toLowerCase()))) {
        map[rule.field] = index
        return
      }
    }
  })
  return map
}

function toRows(value: unknown[][]): string[][] {
  return value.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim())))
}

export async function extractTable(
  file: File,
  kind: FileKind,
  warnings: ExtractWarning[],
): Promise<ExtractedDoc> {
  const buffer = await file.arrayBuffer()
  const doc = makeDoc(kind, file.name)
  const tables: TableBlock[] = []

  if (kind === 'csv') {
    const { text } = decodeTextBuffer(buffer)
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' })
    if (parsed.errors.length > 0) {
      warnings.push({ code: 'truncated', message: `CSV 解析有 ${parsed.errors.length} 处告警，已尽量读取` })
    }
    const rows = toRows(parsed.data as unknown[][])
    if (rows.length === 0) {
      warnings.push({ code: 'no-table', message: 'CSV 没有读到任何数据行' })
    } else {
      tables.push({ sheet: file.name, headers: rows[0] ?? [], rows: rows.slice(1) })
    }
  } else {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: false, dense: false })
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue
      const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' })
      const rows = toRows(raw as unknown[][])
      if (rows.length === 0) continue
      tables.push({ sheet: sheetName, headers: rows[0] ?? [], rows: rows.slice(1) })
      if (sheet['!merges'] && sheet['!merges'].length > 0) {
        warnings.push({
          code: 'merged-cells',
          message: `工作表「${sheetName}」有 ${sheet['!merges'].length} 处合并单元格，已按左上角取值`,
        })
      }
    }
    if (tables.length === 0) warnings.push({ code: 'no-table', message: '工作簿中没有可读数据行' })
  }

  doc.tables = tables
  doc.text = tables
    .map((table) => [table.headers.join('\t'), ...table.rows.map((r) => r.join('\t'))].join('\n'))
    .join('\n\n')
  doc.pageTexts = [doc.text]
  doc.headings = tables.map((t, i) => ({ level: 1, text: t.sheet || `工作表${i + 1}` }))
  if (doc.text.replace(/\s/g, '').length === 0) {
    warnings.push({ code: 'empty-text', message: '表格中没有可读文本' })
  }
  return finalizeDoc(doc)
}

export function guessHeaderRow(rows: readonly (readonly string[])[]): number {
  let best = 0
  let bestScore = -1
  rows.slice(0, 5).forEach((row, index) => {
    const map = autoMapColumns(row)
    const score = (map.stem >= 0 ? 2 : 0) + (map.answer >= 0 ? 2 : 0) + Object.keys(map.options).length
    if (score > bestScore) {
      bestScore = score
      best = index
    }
  })
  return best
}
