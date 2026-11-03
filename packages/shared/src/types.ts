/** 领域类型与前后端共享的 DTO。 */

export const QUESTION_TYPES = ['single', 'multiple', 'judge', 'blank', 'essay'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  blank: '填空题',
  essay: '主观题',
}

export const OBJECTIVE_TYPES: readonly QuestionType[] = ['single', 'multiple', 'judge', 'blank']

export function isObjective(type: QuestionType): boolean {
  return OBJECTIVE_TYPES.includes(type)
}

export const BANK_VISIBILITY = ['public', 'private'] as const
export type BankVisibility = (typeof BANK_VISIBILITY)[number]

export const USER_STATUS = ['active', 'disabled'] as const
export type UserStatus = (typeof USER_STATUS)[number]

/** 掌握度：0 未标记 / 1 模糊 / 2 掌握 */
export const MASTERY = { UNMARKED: 0, VAGUE: 1, MASTERED: 2 } as const
export type Mastery = 0 | 1 | 2

/** 连对 N 次自动升掌握，答错自动降级。 */
export const MASTERY_RIGHT_STREAK = 2

export interface QuestionOption {
  key: string
  text: string
}

export interface QuestionMedia {
  hash: string
  name: string
  mime: string
  size: number
}

/** 仅用于校对时定位原文，不承担版权声明职责。 */
export interface SrcRef {
  file?: string
  page?: number
  paragraph?: number
  row?: number
  sheet?: string
}

export interface Question {
  id: string
  bankId: string
  chapterId: string | null
  type: QuestionType
  no: number | null
  stem: string
  options: QuestionOption[]
  answer: string[]
  explanation: string
  difficulty: number
  tags: string[]
  media: QuestionMedia[]
  srcRef: SrcRef | null
  createdAt: string
}

export interface Chapter {
  id: string
  bankId: string
  name: string
  sortOrder: number
  questionCount?: number
}

export interface Bank {
  id: string
  name: string
  subject: string
  description: string
  visibility: BankVisibility
  ownerId: string
  createdAt: string
  updatedAt: string
}

export interface BankSummary extends Bank {
  questionCount: number
  chapterCount: number
  seenCount: number
  rightCount: number
  wrongCount: number
  favoriteCount: number
  lastStudiedAt: string | null
}

export interface Role {
  id: string
  name: string
  description: string
  perms: string[]
  builtin: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  userCount?: number
}

export interface UserSummary {
  id: string
  username: string
  displayName: string
  status: UserStatus
  mustChangePwd: boolean
  createdAt: string
  lastLoginAt: string | null
  roles: { id: string; name: string }[]
}

export interface MeResponse {
  user: {
    id: string
    username: string
    displayName: string
    status: UserStatus
    mustChangePwd: boolean
  }
  roles: string[]
  perms: string[]
  isOwner: boolean
  settings: PublicSettings
}

export interface PublicSettings {
  siteName: string
  defaultPassScore: number
  guestEnabled: boolean
}

export interface ProgressRow {
  questionId: string
  seen: number
  right: number
  wrong: number
  lastResult: 'right' | 'wrong' | null
  lastAt: string | null
  favorite: boolean
  mastery: Mastery
  note: string
  selfGrade: 'full' | 'partial' | 'none' | null
}

/** 浏览器端待同步的进度操作。 */
export interface ProgressOp {
  questionId: string
  result?: 'right' | 'wrong' | null
  favorite?: boolean
  mastery?: Mastery
  note?: string
  selfGrade?: 'full' | 'partial' | 'none' | null
  at: string
}

export interface ExamConfigInput {
  id?: string
  bankId: string
  name: string
  /** 按章节抽题，空数组表示整库 */
  chapterIds: string[]
  counts: Record<QuestionType, number>
  totalScore: number
  passScore: number
  durationSec: number
  shuffle: boolean
}

export interface ExamRecordSummary {
  id: string
  bankId: string
  bankName: string
  userId: string
  userName: string
  score: number
  totalScore: number
  passed: boolean
  usedSec: number
  startedAt: string
  finishedAt: string | null
}

export interface ExamAnswerItem {
  questionId: string
  answer: string[]
  correct: boolean | null
  selfGrade?: 'full' | 'partial' | 'none' | null
}

export interface ExamRecordDetail extends ExamRecordSummary {
  config: ExamConfigInput
  answers: ExamAnswerItem[]
}

export interface ImportQuestionInput {
  chapterName?: string
  type: QuestionType
  no: number | null
  stem: string
  options: QuestionOption[]
  answer: string[]
  explanation: string
  difficulty: number
  tags: string[]
  media: QuestionMedia[]
  srcRef: SrcRef | null
}

export interface ImportBatchRequest {
  batchIndex: number
  batchCount: number
  chapters: string[]
  questions: ImportQuestionInput[]
  /** 幂等键，重复提交同一批次返回 alreadyImported */
  importId: string
}

export interface ImportBatchResult {
  imported: number
  alreadyImported: boolean
  totalSoFar: number
}

export interface QualityIssue {
  code:
    | 'missing-answer'
    | 'missing-explanation'
    | 'option-count'
    | 'answer-out-of-range'
    | 'duplicate-stem'
    | 'duplicate-no'
    | 'garbled-text'
    | 'empty-stem'
  label: string
  severity: 'error' | 'warn'
}

export interface QualityReport {
  total: number
  byType: Record<QuestionType, number>
  missingAnswer: number
  missingExplanation: number
  optionCountIssues: number
  garbled: number
  duplicateStem: number
  duplicateNo: number
  answerOutOfRange: number
}

export interface StatsSelf {
  totalQuestions: number
  seenQuestions: number
  rightCount: number
  wrongCount: number
  accuracy: number
  todayCount: number
  streakDays: number
  last7Days: { date: string; count: number }[]
  chapterAccuracy: { chapterId: string; chapterName: string; total: number; right: number; accuracy: number }[]
  wrongByChapter: { chapterId: string; chapterName: string; count: number }[]
  selfGradeDist: { full: number; partial: number; none: number }
  examTrend: { date: string; score: number; totalScore: number }[]
}

export interface StatsAll {
  activeUsers: number
  totalUsers: number
  bankCount: number
  questionCount: number
  todayAnswers: number
  dailyAnswers: { date: string; count: number }[]
  bankGrowth: { date: string; count: number }[]
  storage: { sqliteBytes: number; mediaBytes: number; mediaFiles: number; backupBytes: number }
}

export interface AuditLogRow {
  id: string
  userId: string | null
  userName: string | null
  action: string
  targetType: string
  targetId: string | null
  detail: string
  ip: string
  at: string
}

export interface LoginRecordRow {
  createdAt: string
  ua: string
  ip: string
}

export interface ApiError {
  code: string
  message: string
  details?: unknown
}

export interface PageQuery {
  page?: number
  pageSize?: number
  keyword?: string
}
