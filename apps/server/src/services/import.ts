import type { Db } from '../db/index.js'
import type { ImportBatchRequest, ImportBatchResult, ImportQuestionInput } from '@kaoshiya/shared'
import { PERMS, QUESTION_TYPES } from '@kaoshiya/shared'
import { badRequest, forbidden } from '../errors.js'
import { newId, nowIso } from '../util.js'
import { writeAudit } from './audit.js'
import type { Actor } from './roles.js'
import { assertBankManageable, ensureChapter } from './banks.js'

function validateQuestion(input: ImportQuestionInput, index: number): ImportQuestionInput {
  if (!input || typeof input !== 'object') throw badRequest(`第 ${index + 1} 题数据格式错误`)
  const stem = String(input.stem ?? '').trim()
  if (!stem) throw badRequest(`第 ${index + 1} 题题干为空`)
  if (!QUESTION_TYPES.includes(input.type)) throw badRequest(`第 ${index + 1} 题题型非法：${String(input.type)}`)
  const options = Array.isArray(input.options) ? input.options : []
  const answer = Array.isArray(input.answer) ? input.answer.map((a) => String(a)) : []
  if ((input.type === 'single' || input.type === 'multiple') && options.length < 2) {
    throw badRequest(`第 ${index + 1} 题选项少于 2 个`)
  }
  return {
    chapterName: input.chapterName ? String(input.chapterName).trim() : undefined,
    type: input.type,
    no: typeof input.no === 'number' && Number.isFinite(input.no) ? input.no : null,
    stem,
    options: options.map((opt, i) => ({
      key: String(opt?.key ?? String.fromCharCode(65 + i)).toUpperCase().slice(0, 4),
      text: String(opt?.text ?? '').trim(),
    })),
    answer,
    explanation: String(input.explanation ?? ''),
    difficulty: Math.min(5, Math.max(1, Number(input.difficulty) || 3)),
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    media: Array.isArray(input.media) ? input.media : [],
    srcRef: input.srcRef ?? null,
  }
}

/**
 * 分批导入：每批 100 题，按 (bankId, importId, batchIndex) 幂等，
 * 断点续传时重复提交同一批直接返回 alreadyImported。
 */
export function importBatch(
  db: Db,
  actor: Actor,
  bankId: string,
  payload: ImportBatchRequest,
  ip: string,
): ImportBatchResult {
  assertBankManageable(db, actor, bankId)
  if (!payload.importId || typeof payload.importId !== 'string') throw badRequest('缺少 importId')
  if (!Number.isInteger(payload.batchIndex) || payload.batchIndex < 0) throw badRequest('batchIndex 不合法')
  if (!Array.isArray(payload.questions)) throw badRequest('questions 必须是数组')
  if (payload.questions.length > 500) throw badRequest('单批最多 500 题，请分批提交')

  const existing = db
    .prepare('SELECT imported FROM import_batches WHERE bank_id = ? AND import_id = ? AND batch_index = ?')
    .get(bankId, payload.importId, payload.batchIndex) as { imported: number } | undefined
  if (existing) {
    const total = db
      .prepare('SELECT COALESCE(SUM(imported), 0) AS c FROM import_batches WHERE bank_id = ? AND import_id = ?')
      .get(bankId, payload.importId) as { c: number }
    return { imported: existing.imported, alreadyImported: true, totalSoFar: total.c }
  }

  const questions = payload.questions.map((q, i) => validateQuestion(q, i))
  const insert = db.prepare(
    `INSERT INTO questions (id, bank_id, chapter_id, type, no, stem, options, answer, explanation, difficulty, tags, media, src_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const now = nowIso()
  const result = db.transaction(() => {
    for (const q of questions) {
      const chapterId = q.chapterName ? ensureChapter(db, bankId, q.chapterName) : null
      insert.run(
        newId('q'),
        bankId,
        chapterId,
        q.type,
        q.no,
        q.stem,
        JSON.stringify(q.options),
        JSON.stringify(q.answer),
        q.explanation,
        q.difficulty,
        JSON.stringify(q.tags),
        JSON.stringify(q.media),
        q.srcRef ? JSON.stringify(q.srcRef) : null,
        now,
      )
    }
    db.prepare(
      'INSERT INTO import_batches (bank_id, import_id, batch_index, imported, at) VALUES (?, ?, ?, ?, ?)',
    ).run(bankId, payload.importId, payload.batchIndex, questions.length, now)
    db.prepare('UPDATE banks SET updated_at = ? WHERE id = ?').run(now, bankId)
    const total = db
      .prepare('SELECT COALESCE(SUM(imported), 0) AS c FROM import_batches WHERE bank_id = ? AND import_id = ?')
      .get(bankId, payload.importId) as { c: number }
    return total.c
  })
  const totalSoFar = result()

  if (payload.batchIndex === payload.batchCount - 1) {
    writeAudit(db, {
      userId: actor.userId,
      action: 'bank.import',
      targetType: 'bank',
      targetId: bankId,
      detail: { importId: payload.importId, batches: payload.batchCount, questions: totalSoFar },
      ip,
    })
  }
  return { imported: questions.length, alreadyImported: false, totalSoFar }
}

/** 清空题库内所有题目（导入重来用），保留题库与章节。 */
export function clearBankQuestions(db: Db, actor: Actor, bankId: string, ip: string): number {
  assertBankManageable(db, actor, bankId)
  const count = db.prepare('SELECT COUNT(*) AS c FROM questions WHERE bank_id = ?').get(bankId) as { c: number }
  db.transaction(() => {
    db.prepare('DELETE FROM questions WHERE bank_id = ?').run(bankId)
    db.prepare('DELETE FROM import_batches WHERE bank_id = ?').run(bankId)
  })()
  writeAudit(db, {
    userId: actor.userId,
    action: 'bank.clear-questions',
    targetType: 'bank',
    targetId: bankId,
    detail: { removed: count.c },
    ip,
  })
  return count.c
}

export function assertCanImport(actor: Actor): void {
  if (actor.isOwner) return
  if (!actor.perms.includes(PERMS.QUESTION_IMPORT) || !actor.perms.includes(PERMS.BANK_CREATE)) {
    throw forbidden('缺少权限：question:import')
  }
}
