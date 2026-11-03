import type { AppConfig } from './config.js'
import type { Db } from './db/index.js'
import type { AuthContext, PermResolver } from './rbac/resolve.js'
import type { Perm } from '@kaoshiya/shared'

declare module 'fastify' {
  interface FastifyInstance {
    db: Db
    appConfig: AppConfig
    perms: PermResolver
  }

  interface FastifyRequest {
    auth: AuthContext | null
  }
}

export type { AuthContext, Perm }
