import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ROLE_OWNER } from '@kaoshiya/shared'
import { badRequest, conflict } from '../errors.js'
import { hashPassword, validatePasswordStrength } from '../auth/password.js'
import { createSession } from '../auth/session.js'
import { SESSION_COOKIE } from '@kaoshiya/shared'
import { newId, nowIso } from '../util.js'
import { writeAudit } from '../services/audit.js'
import { buildMePayload } from './auth.js'

const bodySchema = z.object({
  username: z.string().min(3).max(32),
  displayName: z.string().max(40).optional(),
  password: z.string().min(8).max(128),
})

/** 一次性初始化：users 表非空后永久关闭，返回 404。 */
export async function setupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/setup/status', async () => {
    const row = app.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
    return { initialized: row.c > 0 }
  })

  app.post(
    '/setup',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const row = app.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
      if (row.c > 0) {
        reply.code(404).send({ code: 'NOT_FOUND', message: '系统已完成初始化' })
        return
      }
      const body = bodySchema.parse(request.body)
      if (!/^[A-Za-z0-9_]{3,32}$/.test(body.username)) throw badRequest('用户名需为 3-32 位字母、数字或下划线')
      const check = validatePasswordStrength(body.password)
      if (!check.ok) throw badRequest(check.reason ?? '密码强度不足')
      const ownerRole = app.db.prepare('SELECT id FROM roles WHERE name = ?').get(ROLE_OWNER) as
        | { id: string }
        | undefined
      if (!ownerRole) throw conflict('内置角色缺失，请检查数据库初始化')
      const hash = await hashPassword(body.password)
      const id = newId('u')
      app.db.transaction(() => {
        app.db
          .prepare(
            `INSERT INTO users (id, username, display_name, status, pwd_hash, created_at, last_login_at, must_change_pwd)
             VALUES (?, ?, ?, 'active', ?, ?, NULL, 0)`,
          )
          .run(id, body.username, body.displayName || '站长', hash, nowIso())
        app.db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, ownerRole.id)
      })()
      const session = createSession(app.db, id, request.headers['user-agent'] ?? '', request.ip)
      reply.setCookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: app.appConfig.secureCookie,
        maxAge: 7 * 24 * 3600,
      })
      writeAudit(app.db, {
        userId: id,
        action: 'system.setup',
        targetType: 'user',
        targetId: id,
        detail: { username: body.username },
        ip: request.ip,
      })
      return buildMePayload(app, id)
    },
  )
}
