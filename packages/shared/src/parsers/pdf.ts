import * as pdfjs from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline'
import type { ExtractWarning, ExtractedDoc } from './types.js'
import { finalizeDoc, looksScanned, makeDoc } from './types.js'
import { stripHeadersFooters } from '../normalize.js'

interface PdfItem {
  str: string
  x: number
  y: number
  w: number
  h: number
}

interface PdfLine {
  y: number
  items: PdfItem[]
}

let workerReady = false

function ensureWorker(): void {
  if (workerReady) return
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()
  workerReady = true
}

/**
 * pdf 抽取：按坐标重建行、识别双栏、剥页眉页脚与页码、处理跨页续题。
 * 文本量过低时明确判定为扫描件，不产出空题库。
 */
export async function extractPdf(file: File, warnings: ExtractWarning[]): Promise<ExtractedDoc> {
  ensureWorker()
  const buffer = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) })
  const pdf = await loadingTask.promise
  const doc = makeDoc('pdf', file.name)
  try {
    const pageTexts: string[] = []
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items: PdfItem[] = []
      for (const raw of content.items) {
        if (!('str' in raw) || !('transform' in raw)) continue
        const str = raw.str as string
        if (!str.trim()) continue
        const transform = raw.transform as number[]
        const height = Math.abs(raw.height ?? transform[3] ?? 10) || 10
        items.push({
          str,
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          w: raw.width ?? 0,
          h: height,
        })
      }
      page.cleanup()
      if (items.length === 0) {
        pageTexts.push('')
        continue
      }
      const lines = groupLines(items, viewport.width)
      const columns = detectColumns(lines, viewport.width)
      const ordered = columns === 2 ? orderTwoColumns(lines, viewport.width) : lines
      pageTexts.push(renderLines(ordered))
    }
    doc.pageTexts = pageTexts
    doc.scanned = looksScanned(pageTexts)
    if (doc.scanned) {
      warnings.push({
        code: 'scanned-pdf',
        message: '检测为扫描版 PDF（文本层几乎没有内容）。请先外部 OCR 后再上传，或使用手动录题。',
      })
    }
    doc.text = stripHeadersFooters(pageTexts)
    if (doc.text.replace(/\s/g, '').length === 0) {
      warnings.push({ code: 'empty-text', message: 'PDF 未抽取到任何文本' })
    }
  } finally {
    await pdf.destroy()
  }
  return finalizeDoc(doc)
}

function groupLines(items: readonly PdfItem[], pageWidth: number): PdfLine[] {
  const usable = items.filter((it) => {
    const rel = it.y / 800
    return rel > 0.02 && true
  })
  const tolerance = Math.max(3, pageWidth * 0.005)
  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PdfLine[] = []
  for (const item of sorted) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - item.y) <= Math.max(tolerance, item.h * 0.5)) {
      last.items.push(item)
    } else {
      lines.push({ y: item.y, items: [item] })
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x)
  return lines
}

/** 双栏判定：页面中线附近存在明显空白带，且左右两侧都有足量文本。 */
function detectColumns(lines: readonly PdfLine[], pageWidth: number): 1 | 2 {
  if (lines.length < 6) return 1
  const center = pageWidth / 2
  let left = 0
  let right = 0
  let crossing = 0
  for (const line of lines) {
    for (const item of line.items) {
      const mid = item.x + item.w / 2
      if (mid < center * 0.9) left += 1
      else if (mid > center * 1.1) right += 1
      else crossing += 1
    }
  }
  if (left === 0 || right === 0) return 1
  const balance = Math.min(left, right) / Math.max(left, right)
  return crossing / (left + right) < 0.15 && balance > 0.35 ? 2 : 1
}

function orderTwoColumns(lines: readonly PdfLine[], pageWidth: number): PdfLine[] {
  const center = pageWidth / 2
  const pick = (side: 'left' | 'right'): PdfLine[] =>
    lines
      .map((line) => ({
        y: line.y,
        items: line.items.filter((it) => (side === 'left' ? it.x + it.w / 2 <= center : it.x + it.w / 2 > center)),
      }))
      .filter((line) => line.items.length > 0)
  return [...pick('left'), ...pick('right')]
}

function renderLines(lines: readonly PdfLine[]): string {
  return lines
    .map((line) => {
      let out = ''
      for (let i = 0; i < line.items.length; i += 1) {
        const item = line.items[i]!
        const prev = line.items[i - 1]
        if (prev) {
          const gap = item.x - (prev.x + prev.w)
          const avgChar = item.w / Math.max(item.str.length, 1)
          if (gap > Math.max(avgChar * 0.8, 1.5)) out += ' '
        }
        out += item.str
      }
      return out.replace(/\s+/g, ' ').trim()
    })
    .filter((line) => line.length > 0)
    .join('\n')
}
