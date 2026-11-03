import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db/index.js'
import type { StatsAll, StatsSelf } from '@kaoshiya/shared'

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function lastNDays(n: number): string[] {
  const out: string[] = []
  const now = Date.now()
  for (let i = n - 1; i >= 0; i -= 1) out.push(dayKey(new Date(now - i * 86_400_000)))
  return out
}

export function statsSelf(db: Db, userId: string): StatsSelf {
  const totals = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM questions q JOIN banks b ON b.id = q.bank_id
            WHERE b.visibility = 'public' OR b.owner_id = ?) AS total_questions,
         (SELECT COUNT(*) FROM progress WHERE user_id = ? AND seen > 0) AS seen_questions,
         (SELECT COUNT(*) FROM progress WHERE user_id = ? AND last_result = 'right') AS right_count,
         (SELECT COUNT(*) FROM progress WHERE user_id = ? AND last_result = 'wrong') AS wrong_count`,
    )
    .get(userId, userId, userId, userId) as {
    total_questions: number
    seen_questions: number
    right_count: number
    wrong_count: number
  }

  const days = lastNDays(7)
  const dailyRows = db
    .prepare(
      `SELECT substr(last_at, 1, 10) AS day, COUNT(*) AS c FROM progress
       WHERE user_id = ? AND last_at IS NOT NULL AND substr(last_at, 1, 10) >= ? GROUP BY day`,
    )
    .all(userId, days[0] ?? '') as { day: string; c: number }[]
  const dailyMap = new Map(dailyRows.map((row) => [row.day, row.c]))
  const today = dayKey(new Date())

  const activeDays = db
    .prepare(
      `SELECT DISTINCT substr(last_at, 1, 10) AS day FROM progress
       WHERE user_id = ? AND last_at IS NOT NULL ORDER BY day DESC LIMIT 400`,
    )
    .all(userId) as { day: string }[]
  let streak = 0
  let cursor = new Date()
  if (activeDays.length > 0 && activeDays[0]?.day !== today) {
    cursor = new Date(Date.now() - 86_400_000)
  }
  const activeSet = new Set(activeDays.map((row) => row.day))
  for (let i = 0; i < 400; i += 1) {
    const key = dayKey(cursor)
    if (!activeSet.has(key)) break
    streak += 1
    cursor = new Date(cursor.getTime() - 86_400_000)
  }

  const chapterRows = db
    .prepare(
      `SELECT c.id AS chapter_id, c.name AS chapter_name,
              COUNT(p.question_id) AS total,
              COALESCE(SUM(CASE WHEN p.last_result = 'right' THEN 1 ELSE 0 END), 0) AS right
       FROM chapters c
       LEFT JOIN questions q ON q.chapter_id = c.id
       LEFT JOIN progress p ON p.question_id = q.id AND p.user_id = ?
       GROUP BY c.id ORDER BY c.sort_order ASC`,
    )
    .all(userId) as { chapter_id: string; chapter_name: string; total: number; right: number }[]

  const wrongRows = db
    .prepare(
      `SELECT c.id AS chapter_id, c.name AS chapter_name, COUNT(*) AS c
       FROM progress p JOIN questions q ON q.id = p.question_id LEFT JOIN chapters c ON c.id = q.chapter_id
       WHERE p.user_id = ? AND p.last_result = 'wrong'
       GROUP BY c.id ORDER BY c DESC`,
    )
    .all(userId) as { chapter_id: string | null; chapter_name: string | null; c: number }[]

  const gradeRows = db
    .prepare('SELECT self_grade, COUNT(*) AS c FROM progress WHERE user_id = ? AND self_grade IS NOT NULL GROUP BY self_grade')
    .all(userId) as { self_grade: 'full' | 'partial' | 'none'; c: number }[]
  const selfGradeDist = { full: 0, partial: 0, none: 0 }
  for (const row of gradeRows) selfGradeDist[row.self_grade] = row.c

  const examRows = db
    .prepare(
      `SELECT substr(finished_at, 1, 10) AS day, score,
              CAST(json_extract(config, '$.config.totalScore') AS REAL) AS total_score
       FROM exam_records WHERE user_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 20`,
    )
    .all(userId) as { day: string; score: number; total_score: number | null }[]

  const denominator = totals.right_count + totals.wrong_count
  return {
    totalQuestions: totals.total_questions,
    seenQuestions: totals.seen_questions,
    rightCount: totals.right_count,
    wrongCount: totals.wrong_count,
    accuracy: denominator > 0 ? Math.round((totals.right_count / denominator) * 1000) / 10 : 0,
    todayCount: dailyMap.get(today) ?? 0,
    streakDays: streak,
    last7Days: days.map((date) => ({ date, count: dailyMap.get(date) ?? 0 })),
    chapterAccuracy: chapterRows.map((row) => ({
      chapterId: row.chapter_id,
      chapterName: row.chapter_name,
      total: row.total,
      right: row.right,
      accuracy: row.total > 0 ? Math.round((row.right / row.total) * 1000) / 10 : 0,
    })),
    wrongByChapter: wrongRows.map((row) => ({
      chapterId: row.chapter_id ?? '',
      chapterName: row.chapter_name ?? '未分章',
      count: row.c,
    })),
    selfGradeDist,
    examTrend: examRows.reverse().map((row) => ({
      date: row.day,
      score: row.score,
      totalScore: row.total_score ?? 100,
    })),
  }
}

function dirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(full)
    else total += fs.statSync(full).size
  }
  return total
}

export function statsAll(db: Db, paths: { databasePath: string; mediaDir: string; backupDir: string }): StatsAll {
  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS total_users,
         (SELECT COUNT(*) FROM users WHERE status = 'active') AS active_users,
         (SELECT COUNT(*) FROM banks) AS bank_count,
         (SELECT COUNT(*) FROM questions) AS question_count`,
    )
    .get() as { total_users: number; active_users: number; bank_count: number; question_count: number }

  const days = lastNDays(14)
  const dailyRows = db
    .prepare(
      `SELECT substr(last_at, 1, 10) AS day, COUNT(*) AS c FROM progress
       WHERE last_at IS NOT NULL AND substr(last_at, 1, 10) >= ? GROUP BY day`,
    )
    .all(days[0] ?? '') as { day: string; c: number }[]
  const dailyMap = new Map(dailyRows.map((row) => [row.day, row.c]))

  const growthRows = db
    .prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM banks WHERE created_at >= ? GROUP BY day')
    .all(days[0] ?? '') as { day: string; c: number }[]
  const growthMap = new Map(growthRows.map((row) => [row.day, row.c]))

  const today = dayKey(new Date())
  let mediaBytes = 0
  let mediaFiles = 0
  for (const entry of fs.existsSync(paths.mediaDir) ? fs.readdirSync(paths.mediaDir, { withFileTypes: true }) : []) {
    if (!entry.isFile()) continue
    mediaBytes += fs.statSync(path.join(paths.mediaDir, entry.name)).size
    mediaFiles += 1
  }

  return {
    activeUsers: counts.active_users,
    totalUsers: counts.total_users,
    bankCount: counts.bank_count,
    questionCount: counts.question_count,
    todayAnswers: dailyMap.get(today) ?? 0,
    dailyAnswers: days.map((date) => ({ date, count: dailyMap.get(date) ?? 0 })),
    bankGrowth: days.map((date) => ({ date, count: growthMap.get(date) ?? 0 })),
    storage: {
      sqliteBytes: fs.existsSync(paths.databasePath) ? fs.statSync(paths.databasePath).size : 0,
      mediaBytes,
      mediaFiles,
      backupBytes: dirSize(paths.backupDir),
    },
  }
}
