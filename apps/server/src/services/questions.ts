import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db/index.js'
import { PERMS } from '@kaoshiya/shared'
import type { ProgressRow, Question, QuestionType } from '@kaoshiya/shared'
import { badRequest, forbidden, notFound } from '../errors.js'
import { newId, nowIso, safeJsonParse } from '../util.js'
import { writeAudit } from './audit.js'
import type { Actor } from './roles.js'
import { assertBankManageable, ensureChapter, getBank } from './banks.js'
import { deleteUnreferencedMedia } from './media.js'

interface QuestionRow {
  id: string
  bank_id: string
  chapter_id: string | null
  type: QuestionType
  no: number | null
  stem: string
  options: string
  answer: string
  explanation: string
  difficulty: number
  tags: string
  media: string
  src_ref: string | null
  created_at: string
}

export function rowToQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    bankId: row.bank_id,
    chapterId: row.chapter_id,
    type: row.type,
    no: row.no,
    stem: row.stem,
    options: safeJsonParse(row.options, []),
    answer: safeJsonParse(row.answer, []),
    explanation: row.explanation,
    difficulty: row.difficulty,
    tags: safeJsonParse(row.tags, []),
    media: safeJsonParse(row.media, []),
    srcRef: row.src_ref ? safeJsonParse(row.src_ref, null) : null,
    createdAt: row.created_at,
  }
}

export interface ListQuestionsQuery {
  chapterId?: string
  type?: QuestionType
  keyword?: string
  page?: number
  pageSize?: number
}

export function listQuestions(
  db: Db,
  bankId: string,
  query: ListQuestionsQuery = {},
): { items: Question[]; total: number } {
  const where = ['bank_id = ?']
  const params: unknown[] = [bankId]
  if (query.chapterId) {
    where.push('chapter_id = ?')
    params.push(query.chapterId)
  }
  if (query.type) {
    where.push('type = ?')
    params.push(query.type)
  }
  if (query.keyword) {
    where.push('(stem LIKE ? OR explanation LIKE ?)')
    params.push(`%${query.keyword}%`, `%${query.keyword}%`)
  }
  const clause = `WHERE ${where.join(' AND ')}`
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(500, Math.max(1, query.pageSize ?? 100))
  const total = db.prepare(`SELECT COUNT(*) AS c FROM questions ${clause}`).get(...params) as { c: number }
  const rows = db
    .prepare(`SELECT * FROM questions ${clause} ORDER BY no IS NULL, no ASC, created_at ASC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as QuestionRow[]
  return { items: rows.map(rowToQuestion), total: total.c }
}

export function getQuestion(db: Db, id: string): Question {
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | undefined
  if (!row) throw notFound('题目不存在')
  return rowToQuestion(row)
}

export function getProgressMap(db: Db, userId: string, questionIds?: readonly string[]): Record<string, ProgressRow> {
  let rows: ProgressSqlRow[]
  if (questionIds && questionIds.length > 0) {
    const chunk: string[] = []
    const out: ProgressSqlRow[] = []
    for (const id of questionIds) {
      chunk.push(id)
      if (chunk.length === 400) {
        const marks = chunk.map(() => '?').join(',')
        out.push(...queryProgress(db, userId, `AND question_id IN (${marks})`, chunk))
        chunk.length = 0
      }
    }
    if (chunk.length > 0) {
      const marks = chunk.map(() => '?').join(',')
      out.push(...queryProgress(db, userId, `AND question_id IN (${marks})`, chunk))
    }
    rows = out
  } else {
    rows = queryProgress(db, userId, '', [])
  }
  const map: Record<string, ProgressRow> = {}
  for (const row of rows) {
    map[row.question_id] = {
      questionId: row.question_id,
      seen: row.seen,
      right: row.right,
      wrong: row.wrong,
      lastResult: row.last_result,
      lastAt: row.last_at,
      favorite: row.favorite === 1,
      mastery: row.mastery as 0 | 1 | 2,
      note: row.note,
      selfGrade: row.self_grade,
    }
  }
  return map
}

interface ProgressSqlRow {
  question_id: string
  seen: number
  right: number
  wrong: number
  last_result: 'right' | 'wrong' | null
  last_at: string | null
  favorite: number
  mastery: number
  note: string
  self_grade: 'full' | 'partial' | 'none' | null
}

function queryProgress(db: Db, userId: string, extra: string, params: unknown[]): ProgressSqlRow[] {
  return db
    .prepare(
      `SELECT question_id, seen, right, wrong, last_result, last_at, favorite, mastery, note, self_grade
       FROM progress WHERE user_id = ? ${extra}`,
    )
    .all(userId, ...params) as ProgressSqlRow[]
}

export type PracticeMode = 'sequential' | 'random' | 'chapter' | 'wrong' | 'favorite' | 'unmastered' | 'continue'

export interface PracticeQuery {
  mode?: PracticeMode
  chapterId?: string
  limit?: number
}

/** 刷题取题：按模式过滤，随机模式用 SQLite random()。 */
export function listPracticeQuestions(
  db: Db,
  auth: { userId: string; perms: readonly string[]; isOwner: boolean },
  bankId: string,
  query: PracticeQuery = {},
): Question[] {
  const bank = getBank(db, bankId)
  if (!(bank.visibility === 'public' || bank.ownerId === auth.userId || auth.perms.includes(PERMS.BANK_UPDATE))) {
    throw forbidden('无权访问该题库')
  }
  const mode = query.mode ?? 'sequential'
  const where = ['q.bank_id = ?']
  const params: unknown[] = [bankId]
  if (query.chapterId) {
    where.push('q.chapter_id = ?')
    params.push(query.chapterId)
  }
  switch (mode) {
    case 'random':
      break
    case 'wrong':
      where.push('EXISTS (SELECT 1 FROM progress p WHERE p.question_id = q.id AND p.user_id = ? AND p.last_result = \'wrong\')')
      params.push(auth.userId)
      break
    case 'favorite':
      where.push('EXISTS (SELECT 1 FROM progress p WHERE p.question_id = q.id AND p.user_id = ? AND p.favorite = 1)')
      params.push(auth.userId)
      break
    case 'unmastered':
      where.push('NOT EXISTS (SELECT 1 FROM progress p WHERE p.question_id = q.id AND p.user_id = ? AND p.mastery = 2)')
      params.push(auth.userId)
      break
    case 'continue':
      where.push('NOT EXISTS (SELECT 1 FROM progress p WHERE p.question_id = q.id AND p.user_id = ? AND p.seen > 0)')
      params.push(auth.userId)
      break
    default:
      break
  }
  const order = mode === 'random' ? 'random()' : 'q.no IS NULL, q.no ASC, q.created_at ASC'
  const limit = Math.min(5000, Math.max(1, query.limit ?? 2000))
  const rows = db
    .prepare(`SELECT q.* FROM questions q WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
    .all(...params, limit) as QuestionRow[]
  return rows.map(rowToQuestion)
}

export interface QuestionPatch {
  type?: QuestionType
  chapterName?: string | null
  no?: number | null
  stem?: string
  options?: { key: string; text: string }[]
  answer?: string[]
  explanation?: string
  difficulty?: number
  tags?: string[]
}

function applyPatch(db: Db, row: QuestionRow, patch: QuestionPatch): void {
  let chapterId = row.chapter_id
  if (patch.chapterName !== undefined) {
    chapterId = patch.chapterName ? ensureChapter(db, row.bank_id, patch.chapterName) : null
  }
  db.prepare(
    `UPDATE questions SET type = ?, chapter_id = ?, no = ?, stem = ?, options = ?, answer = ?, explanation = ?,
     difficulty = ?, tags = ? WHERE id = ?`,
  ).run(
    patch.type ?? row.type,
    chapterId,
    patch.no === undefined ? row.no : patch.no,
    patch.stem ?? row.stem,
    JSON.stringify(patch.options ?? safeJsonParse(row.options, [])),
    JSON.stringify(patch.answer ?? safeJsonParse(row.answer, [])),
    patch.explanation ?? row.explanation,
    patch.difficulty ?? row.difficulty,
    JSON.stringify(patch.tags ?? safeJsonParse(row.tags, [])),
    row.id,
  )
}

export function updateQuestion(db: Db, actor: Actor, id: string, patch: QuestionPatch, ip: string): Question {
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | undefined
  if (!row) throw notFound('题目不存在')
  assertBankManageable(db, actor, row.bank_id)
  if (patch.stem !== undefined && !patch.stem.trim()) throw badRequest('题干不能为空')
  applyPatch(db, row, patch)
  db.prepare('UPDATE banks SET updated_at = ? WHERE id = ?').run(nowIso(), row.bank_id)
  writeAudit(db, { userId: actor.userId, action: 'question.update', targetType: 'question', targetId: id, detail: patch, ip })
  return getQuestion(db, id)
}

export interface QuestionInput extends QuestionPatch {
  stem: string
  type: QuestionType
}

export function createQuestion(db: Db, actor: Actor, bankId: string, input: QuestionInput, ip: string): Question {
  assertBankManageable(db, actor, bankId)
  if (!input.stem.trim()) throw badRequest('题干不能为空')
  const id = newId('q')
  const chapterId = input.chapterName ? ensureChapter(db, bankId, input.chapterName) : null
  db.prepare(
    `INSERT INTO questions (id, bank_id, chapter_id, type, no, stem, options, answer, explanation, difficulty, tags, media, src_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, ?)`,
  ).run(
    id,
    bankId,
    chapterId,
    input.type,
    input.no ?? null,
    input.stem,
    JSON.stringify(input.options ?? []),
    JSON.stringify(input.answer ?? []),
    input.explanation ?? '',
    input.difficulty ?? 3,
    JSON.stringify(input.tags ?? []),
    nowIso(),
  )
  writeAudit(db, { userId: actor.userId, action: 'question.create', targetType: 'question', targetId: id, detail: { bankId }, ip })
  return getQuestion(db, id)
}

export function deleteQuestion(db: Db, actor: Actor, id: string, ip: string, mediaDir: string): void {
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | undefined
  if (!row) throw notFound('题目不存在')
  assertBankManageable(db, actor, row.bank_id)
  const media = safeJsonParse<{ hash: string }[]>(row.media, [])
  db.prepare('DELETE FROM questions WHERE id = ?').run(id)
  deleteUnreferencedMedia(
    db,
    mediaDir,
    media.map((m) => m.hash),
  )
  writeAudit(db, { userId: actor.userId, action: 'question.delete', targetType: 'question', targetId: id, detail: {}, ip })
}

/** 导出题库 JSON（data:export 或题库归属者）。 */
export function exportBank(db: Db, bankId: string): { bank: ReturnType<typeof getBank>; chapters: { name: string; sortOrder: number }[]; questions: Question[] } {
  const bank = getBank(db, bankId)
  const chapters = db
    .prepare('SELECT name, sort_order FROM chapters WHERE bank_id = ? ORDER BY sort_order ASC')
    .all(bankId) as { name: string; sort_order: number }[]
  const rows = db
    .prepare('SELECT * FROM questions WHERE bank_id = ? ORDER BY no IS NULL, no ASC, created_at ASC')
    .all(bankId) as QuestionRow[]
  return {
    bank,
    chapters: chapters.map((c) => ({ name: c.name, sortOrder: c.sort_order })),
    questions: rows.map(rowToQuestion),
  }
}

export function mediaDirOf(config: { mediaDir: string }): string {
  fs.mkdirSync(config.mediaDir, { recursive: true })
  return config.mediaDir
}

export function questionMediaPath(mediaDir: string, file: string): string {
  return path.join(mediaDir, file)
}
