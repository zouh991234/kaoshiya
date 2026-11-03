import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PERMS } from '@kaoshiya/shared'
import { requirePerm } from '../auth/guard.js'
import {
  buildExam,
  deleteExamConfig,
  getExamRecord,
  listExamConfigs,
  listExamRecords,
  saveExamConfig,
  submitExam,
} from '../services/exams.js'
import { actorOf } from './users.js'

const configSchema = z.object({
  id: z.string().optional(),
  bankId: z.string().min(1),
  name: z.string().min(1).max(60),
  chapterIds: z.array(z.string()),
  counts: z.object({
    single: z.number().int().min(0),
    multiple: z.number().int().min(0),
    judge: z.number().int().min(0),
    blank: z.number().int().min(0),
    essay: z.number().int().min(0),
  }),
  totalScore: z.number().min(1).max(1000),
  passScore: z.number().min(0).max(1000),
  durationSec: z.number().int().min(60).max(24 * 3600),
  shuffle: z.boolean(),
})

export async function examRoutes(app: FastifyInstance): Promise<void> {
  app.get('/exam-configs', { preHandler: requirePerm(PERMS.EXAM_CONFIG) }, async (request) => {
    const query = z.object({ bankId: z.string().min(1) }).parse(request.query)
    return { items: listExamConfigs(app.db, query.bankId) }
  })

  app.post('/exam-configs', { preHandler: requirePerm(PERMS.EXAM_CONFIG) }, async (request, reply) => {
    const body = configSchema.parse(request.body)
    reply.code(201)
    return saveExamConfig(app.db, body.bankId, body)
  })

  app.delete('/exam-configs/:id', { preHandler: requirePerm(PERMS.EXAM_CONFIG) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    deleteExamConfig(app.db, params.id)
    return { ok: true }
  })

  app.post('/exams', { preHandler: requirePerm(PERMS.EXAM_TAKE) }, async (request, reply) => {
    const body = configSchema.omit({ id: true }).parse(request.body)
    const built = buildExam(app.db, actorOf(request), body, request.ip)
    reply.code(201)
    return built
  })

  app.get('/exams', { preHandler: requirePerm(PERMS.EXAM_TAKE) }, async (request) => {
    const query = z
      .object({
        userId: z.string().optional(),
        bankId: z.string().optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query)
    return listExamRecords(app.db, actorOf(request), query)
  })

  app.get('/exams/:id', { preHandler: requirePerm(PERMS.EXAM_TAKE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    return getExamRecord(app.db, actorOf(request), params.id)
  })

  app.post('/exams/:id/submit', { preHandler: requirePerm(PERMS.EXAM_TAKE) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    const body = z
      .object({
        usedSec: z.number().int().min(0),
        answers: z.array(
          z.object({
            questionId: z.string().min(1),
            answer: z.array(z.string()),
            correct: z.boolean().nullable().optional(),
            selfGrade: z.union([z.enum(['full', 'partial', 'none']), z.null()]).optional(),
          }),
        ),
      })
      .parse(request.body)
    return submitExam(app.db, actorOf(request), params.id, body)
  })
}
