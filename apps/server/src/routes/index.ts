import type { FastifyInstance } from 'fastify'
import { setupRoutes } from './setup.js'
import { authRoutes } from './auth.js'
import { userRoutes } from './users.js'
import { roleRoutes } from './roles.js'
import { bankRoutes } from './banks.js'
import { progressRoutes } from './progress.js'
import { examRoutes } from './exams.js'
import { statsRoutes } from './stats.js'
import { adminRoutes } from './admin.js'

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (scoped) => {
      await setupRoutes(scoped)
      await authRoutes(scoped)
      await userRoutes(scoped)
      await roleRoutes(scoped)
      await bankRoutes(scoped)
      await progressRoutes(scoped)
      await examRoutes(scoped)
      await statsRoutes(scoped)
      await adminRoutes(scoped)
    },
    { prefix: '/api' },
  )
}
