import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { LoginRecordRow, MeResponse } from '@kaoshiya/shared'
import { SESSION_COOKIE } from '@kaoshiya/shared'
import { ApiError, unauthorized } from '../errors.js'
import { verifyPassword } from '../auth/password.js'
import { createSession, destroySession } from '../auth/session.js'
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from '../auth/login-guard.js'
import { authenticate, requireLogin } from '../auth/guard.js'
import { getSettings } from '../services/settings.js'
import { changeOwnPassword, finishInitialPassword } from '../services/users.js'
import { writeAudit } from '../services/audit.js'
import { nowIso } from '../util.js'

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
  remember: z.boolean().optional(),
})

interface UserRow {
  id: string
  username: string
  display_name: string
  status: 'active' | 'disabled'
  pwd_hash: string
  must_change_pwd: number
}

const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$5vQ1o9v3fQ0m6cWc0h5Q7k1kYb7lP4sZ2zXb0lS0jvE'

export function buildMePayload(app: FastifyInstance, userId: string): MeResponse {
  const row = app.db
    .prepare('SELECT id, username, display_name, status, must_change_pwd FROM users WHERE id = ?')
    .get(userId) as Omit<UserRow, 'pwd_hash'> | undefined
  if (!row) throw unauthorized('账号不存在')
  const resolved = app.perms.resolve(userId)
  return {
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      status: row.status,
      mustChangePwd: row.must_change_pwd === 1,
    },
    roles: resolved.roles,
    perms: resolved.perms,
    isOwner: resolved.isOwner,
    settings: getSettings(app.db),
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = loginSchema.parse(request.body)
      const gate = checkLoginAllowed(request.ip, body.username)
      if (!gate.allowed) {
        throw new ApiError(429, 'TOO_MANY_REQUESTS', gate.reason ?? '登录过于频繁')
      }
      const row = app.db
        .prepare('SELECT * FROM users WHERE username = ?')
        .get(body.username) as UserRow | undefined
      const hash = row?.pwd_hash || DUMMY_HASH
      const ok = await verifyPassword(hash, body.password)
      if (!row || !ok) {
        recordLoginFailure(request.ip, body.username)
        // 不区分「用户不存在」与「密码错误」
        throw unauthorized('用户名或密码不正确')
      }
      if (row.status !== 'active') {
        recordLoginFailure(request.ip, body.username)
        throw unauthorized('账号已被禁用，请联系管理员')
      }
      recordLoginSuccess(row.username)
      const session = createSession(app.db, row.id, request.headers['user-agent'] ?? '', request.ip)
      reply.setCookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: app.appConfig.secureCookie,
        ...(body.remember ? { maxAge: 7 * 24 * 3600 } : {}),
      })
      app.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id)
      app.db
        .prepare('INSERT INTO login_events (user_id, at, ip, ua, success) VALUES (?, ?, ?, ?, 1)')
        .run(row.id, nowIso(), request.ip, (request.headers['user-agent'] ?? '').slice(0, 255))
      return buildMePayload(app, row.id)
    },
  )

  app.post('/auth/logout', async (request, reply) => {
    await authenticate(request, reply)
    const token = request.cookies[SESSION_COOKIE]
    if (token) destroySession(app.db, token)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/me', async (request, reply) => {
    await requireLogin(request, reply)
    return buildMePayload(app, request.auth!.userId)
  })

  app.patch('/me', async (request, reply) => {
    await requireLogin(request, reply)
    const body = z.object({ displayName: z.string().min(1).max(40) }).parse(request.body)
    app.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(body.displayName, request.auth!.userId)
    writeAudit(app.db, {
      userId: request.auth!.userId,
      action: 'user.update-self',
      targetType: 'user',
      targetId: request.auth!.userId,
      detail: body,
      ip: request.ip,
    })
    return buildMePayload(app, request.auth!.userId)
  })

  app.post('/me/password', async (request, reply) => {
    await requireLogin(request, reply)
    const body = z
      .object({ oldPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128) })
      .parse(request.body)
    await changeOwnPassword(app.db, request.auth!.userId, body.oldPassword, body.newPassword, request.ip)
    return { ok: true }
  })

  app.post('/me/finish-initial-password', async (request, reply) => {
    await requireLogin(request, reply)
    const body = z.object({ newPassword: z.string().min(8).max(128) }).parse(request.body)
    await finishInitialPassword(app.db, request.auth!.userId, body.newPassword, request.ip)
    return buildMePayload(app, request.auth!.userId)
  })

  app.get('/me/logins', async (request, reply) => {
    await requireLogin(request, reply)
    const rows = app.db
      .prepare('SELECT at AS createdAt, ua, ip FROM login_events WHERE user_id = ? ORDER BY at DESC LIMIT 10')
      .all(request.auth!.userId) as LoginRecordRow[]
    return { items: rows }
  })

  app.get('/health', async () => ({ ok: true, at: nowIso() }))
}
