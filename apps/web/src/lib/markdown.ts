import DOMPurify from 'dompurify'

/** 受限 Markdown：段落、列表、代码块、表格、图片。渲染前后双向消毒。 */
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'blockquote', 'hr']

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, src: string) => {
      const safe = /^(https?:\/\/|\/media\/|data:image\/)/.test(src) ? src : ''
      return safe ? `<img src="${safe}" alt="${alt}" loading="lazy" />` : alt
    })
}

function renderTable(lines: string[]): string {
  const rows = lines.map((line) =>
    line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((cell) => cell.trim()),
  )
  const header = rows[0] ?? []
  const body = rows.filter((row, index) => index > 0 && !row.every((cell) => /^:?-{2,}:?$/.test(cell)))
  const thead = `<thead><tr>${header.map((cell) => `<th>${renderInline(escapeHtml(cell))}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${body
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(escapeHtml(cell))}</td>`).join('')}</tr>`)
    .join('')}</tbody>`
  return `<table>${thead}${tbody}</table>`
}

export function renderMarkdown(source: string): string {
  if (!source) return ''
  const escaped = escapeHtml(source.replace(/\r\n?/g, '\n'))
  const blocks: string[] = []
  const lines = escaped.split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (/^```/.test(line)) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      blocks.push(`<pre><code>${code.join('\n')}</code></pre>`)
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const tableLines: string[] = []
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index] ?? '')) {
        tableLines.push(lines[index] ?? '')
        index += 1
      }
      blocks.push(renderTable(tableLines))
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: string[] = []
      while (index < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
        index += 1
      }
      const tag = ordered ? 'ol' : 'ul'
      blocks.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`)
      continue
    }
    if (!line.trim()) {
      index += 1
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim() && !/^(```|\s*\||\s*([-*+]|\d+[.)])\s)/.test(lines[index] ?? '')) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(`<p>${renderInline(paragraph.join('<br />'))}</p>`)
  }
  return DOMPurify.sanitize(blocks.join(''), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['src', 'alt', 'loading'],
    ALLOW_DATA_ATTR: false,
  })
}
