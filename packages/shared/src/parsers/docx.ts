import mammoth from 'mammoth'
import type { ExtractWarning, ExtractedDoc, HeadingItem, TableBlock } from './types.js'
import { finalizeDoc, makeDoc } from './types.js'

/**
 * docx 抽取：mammoth 转 HTML 后按段落/表格结构还原，
 * 标题样式用于识别「章 / 节」。
 */
export async function extractDocx(file: File, warnings: ExtractWarning[]): Promise<ExtractedDoc> {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='标题 1'] => h1:fresh",
        "p[style-name='标题 2'] => h2:fresh",
        "p[style-name='标题 3'] => h3:fresh",
      ],
    },
  )
  if (result.messages.length > 0) {
    const serious = result.messages.filter((m) => m.type === 'error')
    if (serious.length > 0) {
      warnings.push({
        code: 'truncated',
        message: `文档有 ${serious.length} 处无法转换的内容：${serious[0]?.message ?? ''}`,
      })
    }
  }
  const parser = new DOMParser()
  const html = parser.parseFromString(result.value, 'text/html')
  const doc = makeDoc('docx', file.name)
  const lines: string[] = []
  const headings: HeadingItem[] = []
  const tables: TableBlock[] = []

  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) {
        const text = (el.textContent ?? '').trim()
        if (text) {
          headings.push({ level: Number(tag.slice(1)), text })
          lines.push(text)
        }
        continue
      }
      if (tag === 'p') {
        const text = (el.textContent ?? '').replace(/\u00a0/g, ' ').trim()
        if (text) lines.push(text)
        continue
      }
      if (tag === 'table') {
        const rows: string[][] = []
        for (const tr of Array.from(el.querySelectorAll('tr'))) {
          const cells = Array.from(tr.querySelectorAll('td,th')).map((c) =>
            (c.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
          )
          if (cells.length) rows.push(cells)
        }
        if (rows.length) {
          const width = Math.max(...rows.map((r) => r.length))
          if (rows.some((r) => r.length !== width)) {
            warnings.push({ code: 'merged-cells', message: '表格存在合并单元格，已按行补齐空列' })
          }
          const padded = rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')])
          const headers = padded[0] ?? []
          tables.push({ sheet: '正文表格', headers, rows: padded.slice(1) })
          for (const row of padded) lines.push(row.join('\t'))
        }
        continue
      }
      if (tag === 'ul' || tag === 'ol') {
        for (const li of Array.from(el.querySelectorAll('li'))) {
          const text = (li.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (text) lines.push(`- ${text}`)
        }
        continue
      }
      walk(el)
    }
  }

  walk(html.body)
  doc.text = lines.join('\n')
  doc.pageTexts = [doc.text]
  doc.headings = headings
  doc.tables = tables
  if (doc.text.replace(/\s/g, '').length === 0) {
    warnings.push({ code: 'empty-text', message: '文档中未抽取到文本，可能是纯图片文档' })
  }
  return finalizeDoc(doc)
}
