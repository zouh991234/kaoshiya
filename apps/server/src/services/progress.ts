import type { Db } from '../db/index.js'
import type { Mastery, ProgressOp, ProgressRow } from '@kaoshiya/shared'
import { MASTERY, MASTERY_RIGHT_STREAK } from '@kaoshiya/shared'
import { badRequest } from '../errors.js'
import { nowIso } from '../util.js'
import { getProgressMap } from './questions.js'

interface Row {
  user_id: string
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

export function getBankProgress(db: Db, userId: string, bankId: string): Record<string, ProgressRow> {
  const rows = db
    .prepare(
      `SELECT p.question_id, p.seen, p.right, p.wrong, p.last_result, p.last_at, p.favorite, p.mastery, p.note, p.self_grade
       FROM progress p JOIN questions q ON q.id = p.question_id
       WHERE p.user_id = ? AND q.bank_id = ?`,
    )
    .all(userId, bankId) as Row[]
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
      mastery: row.mastery as Mastery,
      note: row.note,
      selfGrade: row.self_grade,
    }
  }
  return map
}

export interface ApplyResult {
  applied: number
  skipped: number
  progress: Record<string, ProgressRow>
}

/**
 * 进度同步：客户端短时间窗口合并后批量提交。
 * 幂等策略——带 at 时间戳的结果类操作，若服务端已有更新的记录则跳过计数，避免重放重复累计。
 * 收藏 / 掌握 / 笔记 / 自评是绝对值语义，重复提交安全。
 */
export function applyProgressOps(db: Db, userId: string, ops: readonly ProgressOp[]): ApplyResult {
  if (ops.length === 0) return { applied: 0, skipped: 0, progress: {} }
  if (ops.length > 500) throw badRequest('单次最多同步 500 条进度')
  const select = db.prepare('SELECT * FROM progress WHERE user_id = ? AND question_id = ?')
  const upsert = db.prepare(
    `INSERT INTO progress (user_id, question_id, seen, right, wrong, last_result, last_at, favorite, mastery, note, self_grade)
     VALUES (@user_id, @question_id, @seen, @right, @wrong, @last_result, @last_at, @favorite, @mastery, @note, @self_grade)
     ON CONFLICT(user_id, question_id) DO UPDATE SET
       seen = excluded.seen, right = excluded.right, wrong = excluded.wrong,
       last_result = excluded.last_result, last_at = excluded.last_at,
       favorite = excluded.favorite, mastery = excluded.mastery,
       note = excluded.note, self_grade = excluded.self_grade`,
  )
  const questionExists = db.prepare('SELECT 1 FROM questions WHERE id = ?')
  let applied = 0
  let skipped = 0
  const touched: string[] = []

  db.transaction(() => {
    for (const op of ops) {
      if (!op.questionId) throw badRequest('进度条目缺少 questionId')
      if (!questionExists.get(op.questionId)) {
        skipped += 1
        continue
      }
      const prev = select.get(userId, op.questionId) as Row | undefined
      const state: Row = prev
        ? { ...prev }
        : {
            user_id: userId,
            question_id: op.questionId,
            seen: 0,
            right: 0,
            wrong: 0,
            last_result: null,
            last_at: null,
            favorite: 0,
            mastery: 0,
            note: '',
            self_grade: null,
          }
      const opAt = op.at && !Number.isNaN(Date.parse(op.at)) ? op.at : nowIso()
      const stale = state.last_at !== null && Date.parse(opAt) <= Date.parse(state.last_at)

      if (op.result === 'right' || op.result === 'wrong') {
        if (stale) {
          skipped += 1
        } else {
          state.seen += 1
          if (op.result === 'right') {
            state.right += 1
            if (state.last_result === 'right' && state.right >= MASTERY_RIGHT_STREAK) state.mastery = MASTERY.MASTERED
          } else {
            state.wrong += 1
            state.mastery = MASTERY.UNMARKED
          }
          state.last_result = op.result
          state.last_at = opAt
          applied += 1
        }
      } else if (op.result === null && !stale) {
        // 仅"看到题目"不计数，只更新时间
        state.last_at = opAt
      }

      if (typeof op.favorite === 'boolean') state.favorite = op.favorite ? 1 : 0
      if (typeof op.mastery === 'number' && [0, 1, 2].includes(op.mastery)) state.mastery = op.mastery
      if (typeof op.note === 'string') state.note = op.note.slice(0, 5000)
      if (op.selfGrade !== undefined) state.self_grade = op.selfGrade

      upsert.run(state)
      touched.push(op.questionId)
    }
  })()

  return { applied, skipped, progress: getProgressMap(db, userId, touched) }
}

export function setQuestionMeta(
  db: Db,
  userId: string,
  questionId: string,
  patch: { favorite?: boolean; mastery?: Mastery; note?: string; selfGrade?: 'full' | 'partial' | 'none' | null },
): ProgressRow {
  return applyProgressOps(db, userId, [{ questionId, ...patch, at: nowIso() }]).progress[questionId] as ProgressRow
}
