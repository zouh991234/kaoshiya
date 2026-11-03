import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PERMS, QUESTION_TYPES } from '@kaoshiya/shared'
import { requirePerm } from '../auth/guard.js'
import { badRequest } from '../errors.js'
import {
  assertBankVisible,
  createBank,
  deleteBank,
  getBank,
  listBanks,
  listChapters,
  updateBank,
} from '../services/banks.js'
import {
  createQuestion,
  deleteQuestion,
  getProgressMap,
  listPracticeQuestions,
  listQuestions,
  updateQuestion,
} from '../services/questions.js'
import { clearBankQuestions, importBatch } from '../services/import.js'
import { saveMedia } from '../services/media.js'
import { actorOf } from './users.js'

const bankBody = z.object({
  name: z.string().min(1).max(80),
  subject: z.string().max(80).optional(),
  description: z.string().max(1000).optional(),
  visibility: z.enum(['public', 'private']).optional(),
})

const questionPatchBody = z.object({
  type: z.enum(QUESTION_TYPES).optional(),
  chapterName: z.string().max(80).nullable().optional(),
  no: z.number().int().nullable().optional(),
  stem: z.string().min(1).max(20000).optional(),
  options: z.array(z.object({ key: z.string().max(4), text: z.string().max(2000) })).optional(),
  answer: z.array(z.string().max(2000)).optional(),
  explanation: z.string().max(20000).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string().max(40)).optional(),
})

export async function bankRoutes(app: FastifyInstance): Promise<void> {
  app.get('/banks', { preHandler: requirePerm(PERMS.BANK_READ) }, async (request) => {
    const query = z
      .object({
        keyword: z.string().max(80).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(request.query)
    return listBanks(app.db, request.auth!, query)
  })

  app.post('/banks', { preHandler: requirePerm(PERMS.BANK_CREATE) }, async (request, reply) => {
    const body = bankBody.parse(request.body)
    const bank = createBank(app.db, actorOf(request), body, request.ip)
    reply.code(201)
    return bank
  })

  app.get('/banks/:id', { preHandler: requirePerm(PERMS.BANK_READ) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const bank = assertBankVisible(app.db, actorOf(request), params.id)
    const chapters = listChapters(app.db, params.id)
    const typeRows = app.db
      .prepare('SELECT type, COUNT(*) AS c FROM questions WHERE bank_id = ? GROUP BY type')
      .all(params.id) as { type: string; c: number }[]
    const byType = Object.fromEntries(QUESTION_TYPES.map((t) => [t, 0])) as Record<string, number>
    for (const row of typeRows) byType[row.type] = row.c
    const total = typeRows.reduce((sum, row) => sum + row.c, 0)
    const progress = getProgressMap(app.db, request.auth!.userId)
    const seen = Object.values(progress).filter((p) => p.seen > 0).length
    const chapterRows = app.db
      .prepare(
        `SELECT c.id AS id, COUNT(q.id) AS total,
                COALESCE(SUM(CASE WHEN p.seen > 0 THEN 1 ELSE 0 END), 0) AS seen
         FROM chapters c
         LEFT JOIN questions q ON q.chapter_id = c.id
         LEFT JOIN progress p ON p.question_id = q.id AND p.user_id = ?
         WHERE c.bank_id = ? GROUP BY c.id`,
      )
      .all(request.auth!.userId, params.id) as { id: string; total: number; seen: number }[]
    const chapterProgress = Object.fromEntries(chapterRows.map((row) => [row.id, { seen: row.seen, total: row.total }]))
    return {
      bank,
      chapters,
      byType,
      total,
      progressSummary: {
        seen,
        favorite: Object.values(progress).filter((p) => p.favorite).length,
        mastered: Object.values(progress).filter((p) => p.mastery === 2).length,
      },
      chapterProgress,
    }
  })

  app.patch('/banks/:id', { preHandler: requirePerm(PERMS.BANK_UPDATE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const body = bankBody.partial().parse(request.body)
    return updateBank(app.db, actorOf(request), params.id, body, request.ip)
  })

  app.delete('/banks/:id', { preHandler: requirePerm(PERMS.BANK_DELETE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    deleteBank(app.db, actorOf(request), params.id, request.ip, app.appConfig.mediaDir)
    return { ok: true }
  })

  app.get('/banks/:id/chapters', { preHandler: requirePerm(PERMS.BANK_READ) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    getBank(app.db, params.id)
    return { items: listChapters(app.db, params.id) }
  })

  app.get('/banks/:id/questions', { preHandler: requirePerm(PERMS.QUESTION_READ) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const query = z
      .object({
        chapterId: z.string().optional(),
        type: z.enum(QUESTION_TYPES).optional(),
        keyword: z.string().max(80).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(request.query)
    return listQuestions(app.db, params.id, query)
  })

  app.get('/banks/:id/practice', { preHandler: requirePerm(PERMS.QUESTION_READ) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const query = z
      .object({
        mode: z
          .enum(['sequential', 'random', 'chapter', 'wrong', 'favorite', 'unmastered', 'continue'])
          .optional(),
        chapterId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(5000).optional(),
      })
      .parse(request.query)
    const questions = listPracticeQuestions(app.db, request.auth!, params.id, query)
    const progress = getProgressMap(
      app.db,
      request.auth!.userId,
      questions.map((q) => q.id),
    )
    return { questions, progress, chapters: listChapters(app.db, params.id) }
  })

  app.post(
    '/banks/:id/import',
    { preHandler: requirePerm(PERMS.QUESTION_IMPORT), bodyLimit: 2 * 1024 * 1024, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const params = z.object({ id: z.string() }).parse(request.params)
      const body = z
        .object({
          importId: z.string().min(1).max(64),
          batchIndex: z.number().int().min(0),
          batchCount: z.number().int().min(1),
          chapters: z.array(z.string()).optional(),
          questions: z.array(z.record(z.unknown())).max(500),
        })
        .parse(request.body)
      return importBatch(
        app.db,
        actorOf(request),
        params.id,
        {
          importId: body.importId,
          batchIndex: body.batchIndex,
          batchCount: body.batchCount,
          chapters: body.chapters ?? [],
          questions: body.questions as never,
        },
        request.ip,
      )
    },
  )

  app.post('/banks/:id/clear', { preHandler: requirePerm(PERMS.QUESTION_DELETE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    return { removed: clearBankQuestions(app.db, actorOf(request), params.id, request.ip) }
  })

  app.post('/banks/:id/questions', { preHandler: requirePerm(PERMS.QUESTION_UPDATE) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const body = questionPatchBody.extend({ stem: z.string().min(1).max(20000), type: z.enum(QUESTION_TYPES) }).parse(request.body)
    const question = createQuestion(app.db, actorOf(request), params.id, body, request.ip)
    reply.code(201)
    return question
  })

  app.patch('/questions/:id', { preHandler: requirePerm(PERMS.QUESTION_UPDATE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const body = questionPatchBody.parse(request.body)
    return updateQuestion(app.db, actorOf(request), params.id, body, request.ip)
  })

  app.delete('/questions/:id', { preHandler: requirePerm(PERMS.QUESTION_DELETE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    deleteQuestion(app.db, actorOf(request), params.id, request.ip, app.appConfig.mediaDir)
    return { ok: true }
  })

  app.post('/media', { preHandler: requirePerm(PERMS.QUESTION_UPDATE), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const body = request.body
    if (!Buffer.isBuffer(body)) throw badRequest('请以二进制方式上传图片（Content-Type: image/jpeg|png|webp）')
    const header = request.headers['x-file-name']
    const fileName = typeof header === 'string' && header ? header : 'image'
    const media = saveMedia(app.appConfig.mediaDir, body, fileName)
    return { ...media, url: `/media/${media.hash}.${media.mime.split('/')[1] === 'jpeg' ? 'jpg' : media.mime.split('/')[1]}` }
  })

  app.get('/media/list', { preHandler: requirePerm(PERMS.QUESTION_READ) }, async () => {
    const rows = app.db.prepare("SELECT COUNT(*) AS c FROM questions WHERE media <> '[]'").get() as { c: number }
    return { questionsWithMedia: rows.c }
  })
}
