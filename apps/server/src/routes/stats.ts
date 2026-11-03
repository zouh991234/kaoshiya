import type { FastifyInstance } from 'fastify'
import { PERMS } from '@kaoshiya/shared'
import { requirePerm } from '../auth/guard.js'
import { statsAll, statsSelf } from '../services/stats.js'

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stats/me', { preHandler: requirePerm(PERMS.STATS_SELF) }, async (request) =>
    statsSelf(app.db, request.auth!.userId),
  )

  app.get('/stats/all', { preHandler: requirePerm(PERMS.STATS_ALL) }, async () =>
    statsAll(app.db, {
      databasePath: app.appConfig.databasePath,
      mediaDir: app.appConfig.mediaDir,
      backupDir: app.appConfig.backupDir,
    }),
  )
}
