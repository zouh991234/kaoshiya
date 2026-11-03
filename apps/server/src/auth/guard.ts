import type { FastifyReply, FastifyRequest } from 'fastify'
import { SESSION_COOKIE } from '@kaoshiya/shared'
import type { Perm } from '@kaoshiya/shared'
import { ApiError, forbidden, unauthorized } from '../errors.js'
import { readSession } from './session.js'

interface UserRow {
  id: string
  username: string
  display_name: string
  status: 'active' | 'disabled'
  must_change_pwd: number
}

/** 解析会话并挂载 request.auth；重复调用安全。 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.auth) return
  const token = request.cookies[SESSION_COOKIE]
  if (!token) return
  const session = readSession(request.server.db, token)
  if (!session) {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return
  }
  const row = request.server.db
    .prepare('SELECT id, username, display_name, status, must_change_pwd FROM users WHERE id = ?')
    .get(session.userId) as UserRow | undefined
  if (!row) return
  if (row.status !== 'active') {
    request.server.db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return
  }
  const resolved = request.server.perms.resolve(row.id)
  request.auth = {
    userId: row.id,
    username: row.username,
    displayName: row.display_name,
    status: row.status,
    mustChangePwd: row.must_change_pwd === 1,
    roles: resolved.roles,
    roleIds: resolved.roleIds,
    perms: resolved.perms,
    isOwner: resolved.isOwner,
    sessionToken: token,
  }
}

/** 首次登录强制改密期间，只放行账号相关接口。 */
function assertPasswordReady(request: FastifyRequest): void {
  const auth = request.auth
  if (!auth?.mustChangePwd) return
  const path = request.url.split('?')[0] ?? ''
  const allowed =
    path.startsWith('/api/me') ||
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/setup') ||
    path === '/api/health'
  if (!allowed) {
    throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', '请先修改初始密码后再使用其他功能')
  }
}

/** 必须登录。 */
export async function requireLogin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(request, reply)
  if (!request.auth) throw unauthorized()
  assertPasswordReady(request)
}

/** 逐接口权限校验：权限点来自共享常量，不接受字符串字面量。 */
export function requirePerm(perm: Perm) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply)
    const auth = request.auth
    if (!auth) throw unauthorized()
    assertPasswordReady(request)
    if (!auth.perms.includes(perm)) throw forbidden(`缺少权限：${perm}`)
  }
}

