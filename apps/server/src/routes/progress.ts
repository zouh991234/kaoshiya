import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PERMS } from '@kaoshiya/shared'
import { requirePerm } from '../auth/guard.js'
import { applyProgressOps, getBankProgress, setQuestionMeta } from '../services/progress.js'

const opSchema = z.object({
  questionId: z.string().min(1),
  result: z.union([z.enum(['right', 'wrong']), z.null()]).optional(),
  favorite: z.boolean().optional(),
  mastery: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  note: z.string().max(5000).optional(),
  selfGrade: z.union([z.enum(['full', 'partial', 'none']), z.null()]).optional(),
  at: z.string().min(1),
})

export async function progressRoutes(app: FastifyInstance): Promise<void> {
  app.get('/progress', { preHandler: requirePerm(PERMS.STATS_SELF) }, async (request) => {
    const query = z.object({ bankId: z.string().min(1) }).parse(request.query)
    return { progress: getBankProgress(app.db, request.auth!.userId, query.bankId) }
  })

  app.put(
    '/progress/batch',
    { preHandler: requirePerm(PERMS.STATS_SELF), config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (request) => {
      const body = z.object({ ops: z.array(opSchema).max(500) }).parse(request.body)
      const result = applyProgressOps(app.db, request.auth!.userId, body.ops)
      return { applied: result.applied, skipped: result.skipped, progress: result.progress }
    },
  )

  app.patch('/progress/:questionId', { preHandler: requirePerm(PERMS.STATS_SELF) }, async (request) => {
    const params = z.object({ questionId: z.string().min(1) }).parse(request.params)
    const body = z
      .object({
        favorite: z.boolean().optional(),
        mastery: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
        note: z.string().max(5000).optional(),
        selfGrade: z.union([z.enum(['full', 'partial', 'none']), z.null()]).optional(),
      })
      .parse(request.body)
    return setQuestionMeta(app.db, request.auth!.userId, params.questionId, body)
  })
}
