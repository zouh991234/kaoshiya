/**
 * 切题规则模板：四个可编辑正则（题号 / 选项 / 答案 / 解析）。
 * 前端改一行正则即可实时重切，因此这里是纯函数、无副作用。
 */

import type { QuestionOption } from './types.js'
import { normalizeJudgeAnswer, parseAnswer, toHalfWidth } from './normalize.js'

export interface TemplateRule {
  questionNo: string
  option: string
  answer: string
  explanation: string
}

export interface SplitTemplate extends TemplateRule {
  id: string
  name: string
  builtin: boolean
  description: string
}

export const BUILTIN_TEMPLATES: readonly SplitTemplate[] = [
  {
    id: 'numbered',
    name: '编号式',
    builtin: true,
    description: '每题以「1.」「2、」开头，选项与答案独立成行',
    questionNo: '^\\s*(\\d{1,4})\\s*[.、．)）]\\s*',
    option: '^\\s*([A-H])\\s*[.、．:：)）]\\s*',
    answer: '(?:参考)?答案\\s*[:：]?\\s*(.+)$',
    explanation: '(?:解析|分析|说明)\\s*[:：]?\\s*([\\s\\S]*)',
  },
  {
    id: 'optioned',
    name: '选项式',
    builtin: true,
    description: '选项与题干同行或以 A、B 开头，答案常用（ A ）内嵌',
    questionNo: '^\\s*(\\d{1,4})\\s*[.、．)）]\\s*',
    option: '^\\s*([A-H])\\s*[.、．:：)）]\\s*',
    answer: '(?:答案|故选|正确答案)\\s*[:：]?\\s*([A-H√×对错]{1,8})',
    explanation: '(?:解析|分析|说明)\\s*[:：]?\\s*([\\s\\S]*)',
  },
  {
    id: 'tabular',
    name: '表格式',
    builtin: true,
    description: 'Markdown 表格或制表符分隔，首行为表头',
    questionNo: '^\\s*(\\d{1,4})\\s*\\|',
    option: '^\\s*([A-H])\\s*[|｜]',
    answer: '\\|\\s*([A-H√×对错]{1,8}|[^|]{1,40})\\s*\\|\\s*$',
    explanation: '\\|\\s*([^|]*)\\s*\\|\\s*$',
  },
]

export interface RawBlock {
  index: number
  no: number | null
  text: string
}

export interface ParsedBlock {
  index: number
  no: number | null
  stem: string
  options: QuestionOption[]
  answer: string[]
  explanation: string
}

export class TemplateError extends Error {
  constructor(
    public readonly field: keyof TemplateRule,
    public readonly pattern: string,
    cause: string,
  ) {
    super(`切题规则「${field}」无效：${pattern}（${cause}）`)
    this.name = 'TemplateError'
  }
}

function compile(field: keyof TemplateRule, source: string, flags: string): RegExp {
  try {
    return new RegExp(source, flags)
  } catch (err) {
    throw new TemplateError(field, source, err instanceof Error ? err.message : String(err))
  }
}

/** 按题号正则切块；题号正则无命中时退化为空行分段。 */
export function splitQuestions(text: string, rule: TemplateRule): RawBlock[] {
  const source = text.replace(/\r\n?/g, '\n')
  const noRe = compile('questionNo', rule.questionNo, 'gm')
  const matches = [...source.matchAll(noRe)]
  if (matches.length === 0) {
    return source
      .split(/\n{2,}/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t, index) => ({ index, no: null, text: t }))
  }
  const blocks: RawBlock[] = []
  matches.forEach((match, i) => {
    const start = match.index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? source.length) : source.length
    const noRaw = match[1]
    const no = noRaw ? Number(noRaw) : null
    blocks.push({ index: i, no: Number.isFinite(no) ? no : null, text: source.slice(start, end).trim() })
  })
  return blocks
}

const INLINE_OPTION = /(?:^|\s)([A-H])\s*[.、．:：)）]\s*/g

function splitInlineOptions(line: string): { key: string; text: string }[] | null {
  const marks = [...line.matchAll(INLINE_OPTION)]
  if (marks.length < 2) return null
  const first = marks[0]!
  if ((first.index ?? 0) > 1) return null
  const out: { key: string; text: string }[] = []
  marks.forEach((mark, i) => {
    const start = (mark.index ?? 0) + mark[0].length
    const end = i + 1 < marks.length ? (marks[i + 1]!.index ?? line.length) : line.length
    out.push({ key: (mark[1] ?? 'A').toUpperCase(), text: line.slice(start, end).trim() })
  })
  return out
}

/** 解析单个题目块。答案命中会从题干与解析中剥离。 */
export function parseBlock(block: RawBlock, rule: TemplateRule): ParsedBlock {
  const noRe = compile('questionNo', rule.questionNo, '')
  const optionRe = compile('option', rule.option, '')
  const answerRe = compile('answer', rule.answer, 'i')
  const explanationRe = compile('explanation', rule.explanation, 'i')

  const lines = block.text.split('\n')
  const firstLine = lines.shift() ?? ''
  const stemLines: string[] = [firstLine.replace(noRe, '').trim()].filter(Boolean)

  const options: QuestionOption[] = []
  let answer: string[] = []
  let explanation = ''
  let target: 'stem' | 'option' | 'explanation' = 'stem'
  let currentOption: QuestionOption | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim()) {
      if (target === 'explanation') explanation += '\n'
      continue
    }
    const answerMatch = line.match(answerRe)
    const isAnswerLine = answerMatch && /^(?:参考)?答案|正确答案|故选/i.test(line.trim())
    if (isAnswerLine && answerMatch) {
      const token = answerMatch[1]?.trim() ?? ''
      const judge = normalizeJudgeAnswer(token)
      answer = judge ? [judge] : parseAnswer(token)
      target = 'explanation'
      continue
    }
    const expMatch = line.match(explanationRe)
    if (expMatch && /^(?:解析|分析|说明)/i.test(line.trim())) {
      explanation = expMatch[1]?.trim() ?? ''
      target = 'explanation'
      continue
    }
    const optMatch = line.match(optionRe)
    if (optMatch) {
      currentOption = { key: (optMatch[1] ?? 'A').toUpperCase(), text: line.replace(optionRe, '').trim() }
      options.push(currentOption)
      target = 'option'
      continue
    }
    const inline = target !== 'explanation' ? splitInlineOptions(line) : null
    if (inline) {
      for (const item of inline) options.push({ key: item.key, text: item.text })
      currentOption = options[options.length - 1] ?? null
      target = 'option'
      continue
    }
    if (target === 'stem') stemLines.push(line)
    else if (target === 'option') {
      if (currentOption) {
        currentOption.text = `${currentOption.text}${currentOption.text && !/[。.；;]$/.test(currentOption.text) ? '' : ' '}${line.trim()}`
      } else stemLines.push(line)
    } else {
      explanation = explanation ? `${explanation}\n${line.trim()}` : line.trim()
    }
  }

  const stem = stemLines.join('\n').replace(/\n{2,}/g, '\n').trim()
  return { index: block.index, no: block.no, stem, options, answer, explanation }
}

export function splitAndParse(text: string, rule: TemplateRule): ParsedBlock[] {
  return splitQuestions(text, rule).map((block) => parseBlock(block, rule))
}

/** 答案分离式：用卷末答案表回填。 */
export function applyAnswerMap(blocks: readonly ParsedBlock[], answers: Map<number, string[]>): ParsedBlock[] {
  return blocks.map((block) => {
    if (block.no === null) return block
    const found = answers.get(block.no)
    return found && found.length > 0 ? { ...block, answer: found } : block
  })
}

/** 一题拆两题：按光标位置把题干切成两段，选项与答案保留在第二段。 */
export function splitOneQuestion(
  block: ParsedBlock,
  atStem: string,
  atStemRest: string,
  no: number | null,
): [ParsedBlock, ParsedBlock] {
  const first: ParsedBlock = {
    index: block.index,
    no,
    stem: atStem,
    options: block.options,
    answer: [],
    explanation: '',
  }
  const second: ParsedBlock = {
    index: block.index + 1,
    no: no === null ? null : no + 1,
    stem: atStemRest,
    options: [],
    answer: block.answer,
    explanation: block.explanation,
  }
  return [first, second]
}

/** 判定文本里是否基本没有可解析内容（用于扫描件识别）。 */
export function textDensity(text: string): number {
  const clean = toHalfWidth(text).replace(/\s/g, '')
  return clean.length
}
