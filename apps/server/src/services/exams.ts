import type { Db } from '../db/index.js'
import type {
  ExamAnswerItem,
  ExamConfigInput,
  ExamRecordDetail,
  ExamRecordSummary,
  ProgressOp,
  Question,
  QuestionType,
} from '@kaoshiya/shared'
import { PERMS, judgeAnswer } from '@kaoshiya/shared'
import { badRequest, forbidden, notFound } from '../errors.js'
import { newId, nowIso, safeJsonParse } from '../util.js'
import { writeAudit } from './audit.js'
import type { Actor } from './roles.js'
import { getBank } from './banks.js'
import { rowToQuestion } from './questions.js'
import { applyProgressOps } from './progress.js'

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

interface RecordRow {
  id: string
  user_id: string
  bank_id: string
  config: string
  score: number
  passed: number
  used_sec: number
  answers: string
  started_at: string
  finished_at: string | null
}

export interface BuildExamInput extends Omit<ExamConfigInput, 'id'> {
  name: string
}

export interface BuiltExam {
  examId: string
  config: ExamConfigInput
  questions: Question[]
  startedAt: string
}

const TYPE_ORDER: QuestionType[] = ['single', 'multiple', 'judge', 'blank', 'essay']

/** 组卷：按题型数量从题库 / 指定章节抽题，题目按题型顺序排列，选项顺序不变。 */
export function buildExam(db: Db, actor: Actor, input: BuildExamInput, ip: string): BuiltExam {
  if (!actor.perms.includes(PERMS.EXAM_TAKE)) throw forbidden('缺少权限：exam:take')
  const bank = getBank(db, input.bankId)
  const chapterIds = input.chapterIds ?? []
  const picked: Question[] = []
  const countOf = new Map<QuestionType, number>()

  for (const type of TYPE_ORDER) {
    const want = Math.max(0, Math.floor(input.counts?.[type] ?? 0))
    if (want === 0) continue
    const chapterClause = chapterIds.length > 0 ? `AND chapter_id IN (${chapterIds.map(() => '?').join(',')})` : ''
    const rows = db
      .prepare(
        `SELECT * FROM questions WHERE bank_id = ? AND type = ? ${chapterClause} ORDER BY random() LIMIT ?`,
      )
      .all(input.bankId, type, ...chapterIds, want) as QuestionRow[]
    picked.push(...rows.map(rowToQuestion))
    countOf.set(type, rows.length)
  }
  if (picked.length === 0) {
    throw badRequest(`题库「${bank.name}」中没有符合组卷条件的题目，请调整各题型数量或章节范围`)
  }

  const totalScore = Math.max(1, Number(input.totalScore) || 100)
  const perScore = Math.round((totalScore / picked.length) * 100) / 100
  const config: ExamConfigInput = {
    bankId: input.bankId,
    name: input.name,
    chapterIds,
    counts: input.counts,
    totalScore,
    passScore: Math.min(totalScore, Math.max(0, Number(input.passScore) || 60)),
    durationSec: Math.max(60, Number(input.durationSec) || 3600),
    shuffle: Boolean(input.shuffle),
  }
  const examId = newId('exam')
  const startedAt = nowIso()
  const snapshot = { config, questionIds: picked.map((q) => q.id), perScore }
  db.prepare(
    `INSERT INTO exam_records (id, user_id, bank_id, config, score, passed, used_sec, answers, started_at, finished_at)
     VALUES (?, ?, ?, ?, 0, 0, 0, '[]', ?, NULL)`,
  ).run(examId, actor.userId, input.bankId, JSON.stringify(snapshot), startedAt)
  writeAudit(db, {
    userId: actor.userId,
    action: 'exam.start',
    targetType: 'exam',
    targetId: examId,
    detail: { bankId: input.bankId, questions: picked.length },
    ip,
  })
  return { examId, config, questions: picked, startedAt }
}

export interface SubmitExamInput {
  answers: (Omit<ExamAnswerItem, 'correct'> & { correct?: boolean | null })[]
  usedSec: number
}

export interface SubmitExamResult {
  score: number
  totalScore: number
  passed: boolean
  usedSec: number
  rightCount: number
  wrongCount: number
  objectiveCount: number
  subjectiveCount: number
}

export function submitExam(db: Db, actor: Actor, examId: string, input: SubmitExamInput): SubmitExamResult {
  const row = db.prepare('SELECT * FROM exam_records WHERE id = ?').get(examId) as RecordRow | undefined
  if (!row) throw notFound('考试记录不存在')
  if (row.user_id !== actor.userId) throw forbidden('不能提交他人的考试')
  if (row.finished_at) throw badRequest('该场考试已交卷')
  const snapshot = safeJsonParse<{ config: ExamConfigInput; questionIds: string[]; perScore: number }>(row.config, {
    config: {
      bankId: row.bank_id,
      name: '',
      chapterIds: [],
      counts: { single: 0, multiple: 0, judge: 0, blank: 0, essay: 0 },
      totalScore: 100,
      passScore: 60,
      durationSec: 3600,
      shuffle: false,
    },
    questionIds: [],
    perScore: 1,
  })
  const questions = snapshot.questionIds.map(
    (id) => db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | undefined,
  )
  const answerMap = new Map(input.answers.map((item) => [item.questionId, item]))
  let score = 0
  let rightCount = 0
  let wrongCount = 0
  let objectiveCount = 0
  let subjectiveCount = 0
  const graded: ExamAnswerItem[] = []
  const progressOps: ProgressOp[] = []

  for (const qRow of questions) {
    if (!qRow) continue
    const question = rowToQuestion(qRow)
    const given = answerMap.get(question.id)
    if (question.type === 'essay') {
      subjectiveCount += 1
      const grade = given?.selfGrade ?? 'none'
      const ratio = grade === 'full' ? 1 : grade === 'partial' ? 0.5 : 0
      score += snapshot.perScore * ratio
      if (grade === 'full') rightCount += 1
      else if (grade === 'none') wrongCount += 1
      graded.push({ questionId: question.id, answer: given?.answer ?? [], correct: grade === 'full', selfGrade: grade })
      progressOps.push({
        questionId: question.id,
        result: grade === 'full' ? ('right' as const) : ('wrong' as const),
        selfGrade: grade,
        at: nowIso(),
      })
      continue
    }
    objectiveCount += 1
    const correct = judgeAnswer(question.type, question.answer, given?.answer ?? [])
    if (correct) {
      rightCount += 1
      score += snapshot.perScore
    } else {
      wrongCount += 1
      progressOps.push({ questionId: question.id, result: 'wrong' as const, at: nowIso() })
    }
    if (correct) progressOps.push({ questionId: question.id, result: 'right' as const, at: nowIso() })
    graded.push({ questionId: question.id, answer: given?.answer ?? [], correct })
  }

  const finalScore = Math.round(score * 100) / 100
  const passed = finalScore >= snapshot.config.passScore
  const usedSec = Math.max(0, Math.floor(input.usedSec))
  db.prepare('UPDATE exam_records SET score = ?, passed = ?, used_sec = ?, answers = ?, finished_at = ? WHERE id = ?').run(
    finalScore,
    passed ? 1 : 0,
    usedSec,
    JSON.stringify(graded),
    nowIso(),
    examId,
  )
  // 错题自动进错题本并标未掌握（由 applyProgressOps 的 wrong 分支保证）
  applyProgressOps(db, actor.userId, progressOps)
  writeAudit(db, {
    userId: actor.userId,
    action: 'exam.submit',
    targetType: 'exam',
    targetId: examId,
    detail: { score: finalScore, passed },
    ip: '',
  })
  return {
    score: finalScore,
    totalScore: snapshot.config.totalScore,
    passed,
    usedSec,
    rightCount,
    wrongCount,
    objectiveCount,
    subjectiveCount,
  }
}

interface SummarySqlRow {
  id: string
  user_id: string
  bank_id: string
  score: number
  passed: number
  used_sec: number
  started_at: string
  finished_at: string | null
  config: string
  bank_name: string
  user_name: string
}

function toSummary(row: SummarySqlRow): ExamRecordSummary {
  const snapshot = safeJsonParse<{ config?: ExamConfigInput }>(row.config, {})
  return {
    id: row.id,
    bankId: row.bank_id,
    bankName: row.bank_name,
    userId: row.user_id,
    userName: row.user_name,
    score: row.score,
    totalScore: snapshot.config?.totalScore ?? 100,
    passed: row.passed === 1,
    usedSec: row.used_sec,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

export function listExamRecords(
  db: Db,
  actor: Actor,
  query: { userId?: string; bankId?: string; page?: number; pageSize?: number },
): { items: ExamRecordSummary[]; total: number } {
  const wantOther = query.userId && query.userId !== actor.userId
  if (wantOther && !actor.perms.includes(PERMS.EXAM_VIEW_OTHERS)) throw forbidden('缺少权限：exam:view_others')
  const targetUser = query.userId ?? actor.userId
  const where = ['e.user_id = ?', 'e.finished_at IS NOT NULL']
  const params: unknown[] = [targetUser]
  if (query.bankId) {
    where.push('e.bank_id = ?')
    params.push(query.bankId)
  }
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
  const clause = `WHERE ${where.join(' AND ')}`
  const total = db.prepare(`SELECT COUNT(*) AS c FROM exam_records e ${clause}`).get(...params) as { c: number }
  const rows = db
    .prepare(
      `SELECT e.id, e.user_id, e.bank_id, e.score, e.passed, e.used_sec, e.started_at, e.finished_at, e.config,
              b.name AS bank_name, u.display_name AS user_name
       FROM exam_records e JOIN banks b ON b.id = e.bank_id JOIN users u ON u.id = e.user_id
       ${clause} ORDER BY e.finished_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as SummarySqlRow[]
  return { items: rows.map(toSummary), total: total.c }
}

export function getExamRecord(db: Db, actor: Actor, examId: string): ExamRecordDetail {
  const row = db
    .prepare(
      `SELECT e.*, b.name AS bank_name, u.display_name AS user_name
       FROM exam_records e JOIN banks b ON b.id = e.bank_id JOIN users u ON u.id = e.user_id
       WHERE e.id = ?`,
    )
    .get(examId) as (RecordRow & { bank_name: string; user_name: string }) | undefined
  if (!row) throw notFound('考试记录不存在')
  if (row.user_id !== actor.userId && !actor.perms.includes(PERMS.EXAM_VIEW_OTHERS)) throw forbidden('不能查看他人的考试记录')
  const snapshot = safeJsonParse<{ config: ExamConfigInput; questionIds?: string[] }>(row.config, {
    config: undefined as unknown as ExamConfigInput,
  })
  const ids = snapshot.questionIds ?? []
  const questions = ids
    .map((id) => db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | undefined)
    .filter((question): question is QuestionRow => Boolean(question))
    .map(rowToQuestion)
  return {
    ...toSummary(row),
    config: snapshot.config,
    answers: safeJsonParse<ExamAnswerItem[]>(row.answers, []),
    questions,
  }
}

export function listExamConfigs(db: Db, bankId: string): { id: string; name: string; config: ExamConfigInput }[] {
  const rows = db
    .prepare('SELECT id, name, config FROM exam_configs WHERE bank_id = ? ORDER BY created_at DESC')
    .all(bankId) as { id: string; name: string; config: string }[]
  return rows.map((row) => ({ id: row.id, name: row.name, config: safeJsonParse(row.config, {} as ExamConfigInput) }))
}

export function saveExamConfig(db: Db, bankId: string, input: ExamConfigInput): { id: string } {
  const id = input.id ?? newId('ec')
  const existing = db.prepare('SELECT id FROM exam_configs WHERE id = ?').get(id)
  if (existing) {
    db.prepare('UPDATE exam_configs SET name = ?, config = ? WHERE id = ?').run(input.name, JSON.stringify(input), id)
  } else {
    db.prepare('INSERT INTO exam_configs (id, bank_id, name, config, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      bankId,
      input.name,
      JSON.stringify(input),
      nowIso(),
    )
  }
  return { id }
}

export function deleteExamConfig(db: Db, id: string): void {
  db.prepare('DELETE FROM exam_configs WHERE id = ?').run(id)
}
