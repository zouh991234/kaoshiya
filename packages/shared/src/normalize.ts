/**
 * 文本归一化、答案解析与题型识别。
 * 铁律：绝不改写题干原意，只做去噪、全半角、断行合并、空白压缩。
 */

import type { QuestionOption, QualityIssue, QualityReport, QuestionType } from './types.js'
import { QUESTION_TYPES } from './types.js'

const FULLWIDTH_ALNUM = /[\uFF01-\uFF5E]/g

/** 全角 ASCII 段转半角，中文标点保持原样。 */
export function toHalfWidth(input: string): string {
  return input.replace(FULLWIDTH_ALNUM, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

export function compressSpace(input: string): string {
  return input.replace(/[\s\u00a0\u3000]+/g, ' ').trim()
}

/** 合并被换行切断的句子：行尾没有标点时与下一行拼接。 */
export function joinBrokenLines(lines: readonly string[]): string {
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (out.length) out.push('')
      continue
    }
    const prev = out[out.length - 1]
    if (prev && prev !== '' && !/[。．.？?！!；;：:，,、）)」』】]$/.test(prev)) {
      out[out.length - 1] = prev + line
    } else {
      out.push(line)
    }
  }
  return out.join('\n').trim()
}

/** 去掉页眉页脚：纯页码行、重复出现的首尾行。 */
export function stripHeadersFooters(pages: readonly string[]): string {
  const lineCount = new Map<string, number>()
  const pageLines = pages.map((page) =>
    page.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0),
  )
  const pagesTotal = Math.max(pages.length, 1)
  for (const lines of pageLines) {
    const edge = new Set<string>([
      ...lines.slice(0, 2),
      ...lines.slice(Math.max(lines.length - 2, 0)),
    ])
    for (const line of edge) {
      if (line.length > 60) continue
      lineCount.set(line, (lineCount.get(line) ?? 0) + 1)
    }
  }
  const repeated = new Set<string>()
  for (const [line, count] of lineCount) {
    if (pagesTotal >= 3 && count >= Math.ceil(pagesTotal * 0.6)) repeated.add(line)
  }
  return pageLines
    .map((lines) =>
      lines
        .filter((line) => !repeated.has(line))
        .filter((line) => !/^[-—–\s]*(第\s*\d+\s*页|\d+\s*\/\s*\d+|page\s*\d+|\d{1,4})[-—–\s]*$/i.test(line))
        .join('\n'),
    )
    .join('\n')
}

const JUDGE_TRUE = ['√', '✓', '✔', '对的', '对', '正确', '是', 't', 'true', 'y', 'yes', '1']
const JUDGE_FALSE = ['×', '✗', '✘', 'x', '错的', '错', '错误', '否', 'f', 'false', 'n', 'no', '0']

export function isJudgeToken(raw: string): boolean {
  const t = toHalfWidth(raw).trim().toLowerCase()
  if (!t) return false
  return JUDGE_TRUE.includes(t) || JUDGE_FALSE.includes(t)
}

/** 判断题统一存为 T / F。 */
export function normalizeJudgeAnswer(raw: string): 'T' | 'F' | null {
  const t = toHalfWidth(raw).trim().toLowerCase()
  if (JUDGE_TRUE.includes(t)) return 'T'
  if (JUDGE_FALSE.includes(t)) return 'F'
  return null
}

/**
 * 解析答案串为选项字母数组。
 * 支持 "A"、"ABC"、"A、B、C"、"A,B"、"1"、"①"、"答案：A"。
 */
export function parseAnswer(raw: string): string[] {
  const text = toHalfWidth(raw)
    .replace(/^[【\[(（]?\s*(参考)?答案\s*[】\])）]?\s*[:：]?/i, '')
    .trim()
  if (!text) return []
  const judge = normalizeJudgeAnswer(text)
  if (judge) return [judge]
  const circled = text.match(/[①②③④⑤⑥⑦⑧]/g)
  if (circled) return circled.map((c) => String.fromCharCode(65 + '①②③④⑤⑥⑦⑧'.indexOf(c)))
  const letters = toHalfWidth(text).toUpperCase().match(/[A-H]/g)
  if (letters && letters.length > 0) {
    const compact = text.replace(/[\s,，、;；/|]/g, '')
    if (/^[A-H]+$/.test(compact)) return [...new Set(compact.split(''))].sort()
    return [...new Set(letters)].sort()
  }
  return [text]
}

/** 卷末集中答案：1-10 ABCDA / 1.A 2.B / 1、√ / 5 对 */
export function parseAnswerSection(raw: string): Map<number, string[]> {
  const map = new Map<number, string[]>()
  const text = toHalfWidth(raw)
  const rangeMatch = text.matchAll(/(\d{1,4})\s*[-—~至]\s*(\d{1,4})\s*[:：]?\s*([A-H√×对错T F]+)/g)
  for (const m of rangeMatch) {
    const start = Number(m[1])
    const end = Number(m[2])
    const tokens = (m[3] ?? '').replace(/\s/g, '').split('')
    if (end - start + 1 !== tokens.length) continue
    tokens.forEach((token, idx) => {
      const answer = parseAnswer(token)
      if (answer.length) map.set(start + idx, answer)
    })
  }
  const pairMatch = text.matchAll(/(\d{1,4})\s*[.、:：)）]\s*([A-H]{1,8}|√|×|对|错|正确|错误)(?![A-Za-z\d])/g)
  for (const m of pairMatch) {
    const no = Number(m[1])
    if (map.has(no)) continue
    const answer = parseAnswer(m[2] ?? '')
    if (answer.length) map.set(no, answer)
  }
  return map
}

export interface DetectInput {
  stem: string
  options: QuestionOption[]
  answer: string[]
}

/** 题型识别：只依据选项与答案形态，不改题干。 */
export function detectQuestionType(input: DetectInput): QuestionType {
  const answer = input.answer.filter((a) => a.trim().length > 0)
  if (input.options.length >= 2) {
    return answer.length > 1 ? 'multiple' : 'single'
  }
  if (answer.length === 1 && (answer[0] === 'T' || answer[0] === 'F')) return 'judge'
  if (/[（(]\s*[)）]/.test(input.stem) && answer.length === 0) return 'judge'
  if (answer.length === 0) return 'blank'
  if (answer.length === 1 && isJudgeToken(answer[0] ?? '')) return 'judge'
  const longest = Math.max(...answer.map((a) => a.length), 0)
  const essayStem = /简答|论述|试述|详述|请说明|请简述|问答题|计算题/.test(input.stem)
  if (answer.length === 1 && (longest > 24 || essayStem)) return 'essay'
  return 'blank'
}

/** 答案越界：单选题答案字母超出选项范围。 */
export function answerOutOfRange(options: readonly QuestionOption[], answer: readonly string[]): boolean {
  if (options.length === 0) return false
  const keys = new Set(options.map((o) => o.key.toUpperCase()))
  return answer.some((a) => {
    const t = a.trim().toUpperCase()
    if (t === 'T' || t === 'F') return false
    if (!/^[A-H]$/.test(t)) return false
    return !keys.has(t)
  })
}

export function looksGarbled(text: string): boolean {
  if (!text) return false
  if (/[\uFFFD]/.test(text)) return true
  const ctrl = [...text].filter((ch) => {
    const code = ch.charCodeAt(0)
    return code < 32 && code !== 10 && code !== 9
  }).length
  if (ctrl / text.length > 0.02) return true
  const ratio = [...text].filter((ch) => /[\uE000-\uF8FF]/.test(ch)).length / text.length
  return ratio > 0.02
}

export function normalizeStem(text: string): string {
  return compressSpace(toHalfWidth(text).replace(/\uFFFD/g, '')).trim()
}

export function normalizeOptions(options: readonly QuestionOption[]): QuestionOption[] {
  return options
    .map((opt, idx) => ({
      key: (opt.key || String.fromCharCode(65 + idx)).toUpperCase(),
      text: compressSpace(opt.text),
    }))
    .filter((opt) => opt.text.length > 0)
}

export interface QualityInput {
  stem: string
  type: QuestionType
  options: QuestionOption[]
  answer: string[]
  explanation: string
  no: number | null
}

export function questionIssues(input: QualityInput): QualityIssue[] {
  const issues: QualityIssue[] = []
  if (!input.stem.trim()) issues.push({ code: 'empty-stem', label: '题干为空', severity: 'error' })
  if (input.answer.filter((a) => a.trim()).length === 0)
    issues.push({ code: 'missing-answer', label: '缺答案', severity: 'error' })
  if (!input.explanation.trim())
    issues.push({ code: 'missing-explanation', label: '缺解析', severity: 'warn' })
  if ((input.type === 'single' || input.type === 'multiple') && input.options.length < 2)
    issues.push({ code: 'option-count', label: '选项少于 2 个', severity: 'error' })
  if (input.type === 'single' && input.answer.length > 1)
    issues.push({ code: 'option-count', label: '单选题有多个答案', severity: 'error' })
  if (answerOutOfRange(input.options, input.answer))
    issues.push({ code: 'answer-out-of-range', label: '答案越界', severity: 'error' })
  if (looksGarbled(input.stem) || looksGarbled(input.explanation))
    issues.push({ code: 'garbled-text', label: '疑似乱码', severity: 'warn' })
  return issues
}

/** 质量报告：重复题干、重复题号需要跨题比较，单独计算。 */
export function buildQualityReport(items: readonly QualityInput[]): QualityReport {
  const byType = Object.fromEntries(QUESTION_TYPES.map((t) => [t, 0])) as Record<QuestionType, number>
  const stemMap = new Map<string, number>()
  const noMap = new Map<number, number>()
  let missingAnswer = 0
  let missingExplanation = 0
  let optionCountIssues = 0
  let garbled = 0
  let answerRange = 0

  for (const item of items) {
    byType[item.type] += 1
    if (!item.answer.filter((a) => a.trim()).length) missingAnswer += 1
    if (!item.explanation.trim()) missingExplanation += 1
    if ((item.type === 'single' || item.type === 'multiple') && item.options.length < 2) optionCountIssues += 1
    if (looksGarbled(item.stem)) garbled += 1
    if (answerOutOfRange(item.options, item.answer)) answerRange += 1
    const stemKey = compressSpace(item.stem).slice(0, 200)
    if (stemKey) stemMap.set(stemKey, (stemMap.get(stemKey) ?? 0) + 1)
    if (typeof item.no === 'number') noMap.set(item.no, (noMap.get(item.no) ?? 0) + 1)
  }

  let duplicateStem = 0
  for (const count of stemMap.values()) if (count > 1) duplicateStem += count - 1
  let duplicateNo = 0
  for (const count of noMap.values()) if (count > 1) duplicateNo += count - 1

  return {
    total: items.length,
    byType,
    missingAnswer,
    missingExplanation,
    optionCountIssues,
    garbled,
    duplicateStem,
    duplicateNo,
    answerOutOfRange: answerRange,
  }
}

/** 标记出重复题干/题号的题目下标，供校对工作台逐题打标。 */
export function findDuplicateIndexes(items: readonly QualityInput[]): { stems: Set<number>; nos: Set<number> } {
  const stemSeen = new Map<string, number[]>()
  const noSeen = new Map<number, number[]>()
  items.forEach((item, idx) => {
    const key = compressSpace(item.stem).slice(0, 200)
    if (key) stemSeen.set(key, [...(stemSeen.get(key) ?? []), idx])
    if (typeof item.no === 'number') noSeen.set(item.no, [...(noSeen.get(item.no) ?? []), idx])
  })
  const stems = new Set<number>()
  const nos = new Set<number>()
  for (const list of stemSeen.values()) if (list.length > 1) list.forEach((i) => stems.add(i))
  for (const list of noSeen.values()) if (list.length > 1) list.forEach((i) => nos.add(i))
  return { stems, nos }
}

/** 客观题判分。填空题按归一化文本比对，支持多个可接受答案。 */
export function judgeAnswer(type: QuestionType, correct: readonly string[], given: readonly string[]): boolean {
  if (type === 'essay') return false
  const norm = (arr: readonly string[]) => arr.map((a) => compressSpace(toHalfWidth(a)).toLowerCase()).sort()
  const a = norm(correct)
  const b = norm(given)
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}
