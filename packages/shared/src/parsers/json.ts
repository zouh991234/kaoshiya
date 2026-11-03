import type { ExtractWarning, ExtractedDoc } from './types.js'
import { finalizeDoc, makeDoc } from './types.js'
import type { ImportQuestionInput, QuestionOption, QuestionType } from '../types.js'
import { QUESTION_TYPES } from '../types.js'
import { detectQuestionType, normalizeJudgeAnswer, parseAnswer } from '../normalize.js'

function asOptions(raw: unknown): QuestionOption[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((item, idx) => {
      if (typeof item === 'string') return { key: String.fromCharCode(65 + idx), text: item }
      const obj = item as Record<string, unknown>
      return {
        key: String(obj.key ?? obj.label ?? String.fromCharCode(65 + idx)).toUpperCase(),
        text: String(obj.text ?? obj.value ?? obj.content ?? ''),
      }
    })
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({
      key: key.toUpperCase(),
      text: String(value),
    }))
  }
  return []
}

function asAnswer(raw: unknown): string[] {
  if (raw === null || raw === undefined) return []
  if (Array.isArray(raw)) return raw.map((a) => String(a).trim()).filter(Boolean)
  const text = String(raw).trim()
  if (!text) return []
  return parseAnswer(text)
}

function asTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string' && raw.trim()) return raw.split(/[,，;；|]/).map((t) => t.trim()).filter(Boolean)
  return []
}

function asType(raw: unknown, fallback: QuestionType): QuestionType {
  if (typeof raw === 'string') {
    const lowered = raw.toLowerCase()
    if ((QUESTION_TYPES as readonly string[]).includes(lowered)) return lowered as QuestionType
    if (raw.includes('单选')) return 'single'
    if (raw.includes('多选')) return 'multiple'
    if (raw.includes('判断')) return 'judge'
    if (raw.includes('填空')) return 'blank'
    if (raw.includes('主观') || raw.includes('简答') || raw.includes('问答')) return 'essay'
  }
  return fallback
}

function mapQuestion(raw: unknown, index: number, chapterDefault: string): ImportQuestionInput {
  const obj = (raw ?? {}) as Record<string, unknown>
  const stem = String(obj.stem ?? obj.title ?? obj.question ?? obj.content ?? '').trim()
  const options = asOptions(obj.options ?? obj.choices)
  let answer = asAnswer(obj.answer ?? obj.correct ?? obj.key)
  const judge = answer.length === 1 ? normalizeJudgeAnswer(answer[0] ?? '') : null
  if (judge) answer = [judge]
  const explanation = String(obj.explanation ?? obj.analysis ?? obj.explain ?? '').trim()
  const noRaw = obj.no ?? obj.index ?? obj.number
  const no = typeof noRaw === 'number' ? noRaw : Number.isFinite(Number(noRaw)) && noRaw !== undefined ? Number(noRaw) : index + 1
  const type = asType(obj.type, detectQuestionType({ stem, options, answer }))
  const difficultyRaw = Number(obj.difficulty ?? 3)
  return {
    chapterName: String(obj.chapter ?? obj.chapterName ?? chapterDefault ?? '').trim() || undefined,
    type,
    no: Number.isFinite(no) ? no : index + 1,
    stem,
    options,
    answer,
    explanation,
    difficulty: Number.isFinite(difficultyRaw) ? Math.min(5, Math.max(1, Math.round(difficultyRaw))) : 3,
    tags: asTags(obj.tags),
    media: [],
    srcRef: null,
  }
}

function collectQuestions(raw: unknown): { list: unknown[]; chapter: string } {
  if (Array.isArray(raw)) return { list: raw, chapter: '' }
  const obj = (raw ?? {}) as Record<string, unknown>
  if (Array.isArray(obj.questions)) {
    return { list: obj.questions, chapter: String(obj.chapter ?? obj.name ?? '') }
  }
  if (Array.isArray(obj.banks)) {
    const list: unknown[] = []
    for (const bank of obj.banks) {
      const b = (bank ?? {}) as Record<string, unknown>
      if (!Array.isArray(b.questions)) continue
      for (const q of b.questions) list.push(q)
    }
    return { list, chapter: '' }
  }
  if (obj.stem || obj.question) return { list: [raw], chapter: '' }
  return { list: [], chapter: '' }
}

export async function extractJson(file: File, warnings: ExtractWarning[]): Promise<ExtractedDoc> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(`JSON 语法错误：${err instanceof Error ? err.message : String(err)}`)
  }
  const { list, chapter } = collectQuestions(parsed)
  const doc = makeDoc('json', file.name)
  if (list.length === 0) {
    warnings.push({ code: 'empty-text', message: 'JSON 中没有找到题目数组（questions）' })
  }
  doc.direct = list.map((item, index) => mapQuestion(item, index, chapter))
  doc.text = doc.direct
    .map((q) => {
      const opts = q.options.map((o) => `${o.key}. ${o.text}`).join('\n')
      return [q.no === null ? '' : `${q.no}. ${q.stem}`, opts, `答案：${q.answer.join('')}`, q.explanation ? `解析：${q.explanation}` : '']
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
  doc.pageTexts = [doc.text]
  return finalizeDoc(doc)
}
