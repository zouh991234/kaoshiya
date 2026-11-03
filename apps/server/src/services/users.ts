import { ROLE_OWNER, normalizePerms } from '@kaoshiya/shared'
import type { UserSummary } from '@kaoshiya/shared'
import type { Db } from '../db/index.js'
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.js'
import { generateInitialPassword, newId, nowIso, safeJsonParse } from '../util.js'
import { hashPassword, validatePasswordStrength, verifyPassword } from '../auth/password.js'
import { destroyUserSessions } from '../auth/session.js'
import { writeAudit } from './audit.js'
import { computeUserPerms } from '../rbac/resolve.js'
import type { Actor } from './roles.js'
import { assertCanGrant, assertGovernanceRetained } from './roles.js'

interface UserRow {
  id: string
  username: string
  display_name: string
  status: 'active' | 'disabled'
  pwd_hash: string
  created_at: string
  last_login_at: string | null
  must_change_pwd: number
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/
const OWNER_ROLE_ID = `role_${ROLE_OWNER}`

function toSummary(db: Db, row: UserRow): UserSummary {
  const roles = db
    .prepare(
      `SELECT r.id AS id, r.name AS name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? ORDER BY r.builtin DESC, r.sort_order ASC`,
    )
    .all(row.id) as { id: string; name: string }[]
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    status: row.status,
    mustChangePwd: row.must_change_pwd === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    roles,
  }
}

export interface ListUsersQuery {
  keyword?: string
  roleId?: string
  status?: 'active' | 'disabled'
  page?: number
  pageSize?: number
}

export function listUsers(db: Db, query: ListUsersQuery): { items: UserSummary[]; total: number } {
  const where: string[] = []
  const params: unknown[] = []
  if (query.keyword) {
    where.push('(u.username LIKE ? OR u.display_name LIKE ?)')
    const like = `%${query.keyword}%`
    params.push(like, like)
  }
  if (query.status) {
    where.push('u.status = ?')
    params.push(query.status)
  }
  if (query.roleId) {
    where.push('EXISTS (SELECT 1 FROM user_roles ur2 WHERE ur2.user_id = u.id AND ur2.role_id = ?)')
    params.push(query.roleId)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 20))
  const total = db.prepare(`SELECT COUNT(*) AS c FROM users u ${clause}`).get(...params) as { c: number }
  const rows = db
    .prepare(`SELECT u.* FROM users u ${clause} ORDER BY u.created_at ASC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as UserRow[]
  return { items: rows.map((row) => toSummary(db, row)), total: total.c }
}

export function getUser(db: Db, id: string): UserSummary {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  if (!row) throw notFound('用户不存在')
  return toSummary(db, row)
}

function loadRow(db: Db, id: string): UserRow {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  if (!row) throw notFound('用户不存在')
  return row
}

function isOwnerUser(db: Db, userId: string): boolean {
  return computeUserPerms(db, userId).roles.includes(ROLE_OWNER)
}

/** admin 不能修改 owner 的账号与角色。 */
function assertOwnerGuard(actor: Actor, db: Db, targetId: string, action: string): void {
  if (actor.isOwner) return
  if (isOwnerUser(db, targetId)) throw forbidden(`不能${action} owner 的账号`)
}

function rolePermsUnion(db: Db, roleIds: readonly string[]): string[] {
  if (roleIds.length === 0) return []
  const placeholders = roleIds.map(() => '?').join(',')
  const rows = db.prepare(`SELECT perms FROM roles WHERE id IN (${placeholders})`).all(...roleIds) as {
    perms: string
  }[]
  const union = new Set<string>()
  for (const row of rows) for (const perm of safeJsonParse<string[]>(row.perms, [])) union.add(perm)
  return normalizePerms([...union])
}

function assignRoles(db: Db, userId: string, roleIds: readonly string[]): void {
  db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId)
  const insert = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)')
  for (const roleId of roleIds) insert.run(userId, roleId)
}

function validateRoleIds(db: Db, roleIds: readonly string[]): string[] {
  const unique = [...new Set(roleIds)]
  for (const roleId of unique) {
    const row = db.prepare('SELECT id FROM roles WHERE id = ?').get(roleId) as { id: string } | undefined
    if (!row) throw badRequest(`角色不存在：${roleId}`)
  }
  return unique
}

export interface CreateUserInput {
  username: string
  displayName?: string
  roleIds: string[]
}

export async function createUser(
  db: Db,
  actor: Actor,
  input: CreateUserInput,
  ip: string,
): Promise<{ user: UserSummary; initialPassword: string }> {
  if (!USERNAME_RE.test(input.username)) throw badRequest('用户名需为 3-32 位字母、数字或下划线')
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(input.username)
  if (exists) throw conflict(`用户名「${input.username}」已存在`)
  const roleIds = validateRoleIds(db, input.roleIds)
  if (roleIds.length === 0) throw badRequest('至少分配一个角色')
  if (roleIds.includes(OWNER_ROLE_ID)) throw forbidden('owner 全局唯一，不能创建第二个 owner')
  assertCanGrant(actor, rolePermsUnion(db, roleIds))

  const initialPassword = generateInitialPassword()
  const hash = await hashPassword(initialPassword)
  const id = newId('u')
  const now = nowIso()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, username, display_name, status, pwd_hash, created_at, last_login_at, must_change_pwd)
       VALUES (?, ?, ?, 'active', ?, ?, NULL, 1)`,
    ).run(id, input.username, input.displayName || input.username, hash, now)
    assignRoles(db, id, roleIds)
  })()
  writeAudit(db, {
    userId: actor.userId,
    action: 'user.create',
    targetType: 'user',
    targetId: id,
    detail: { username: input.username, roleIds },
    ip,
  })
  return { user: getUser(db, id), initialPassword }
}

export interface UpdateUserInput {
  displayName?: string
  status?: 'active' | 'disabled'
  username?: string
}

export function updateUser(db: Db, actor: Actor, id: string, patch: UpdateUserInput, ip: string): UserSummary {
  const row = loadRow(db, id)
  assertOwnerGuard(actor, db, id, '修改')
  if (id === actor.userId && patch.status === 'disabled') throw forbidden('不能禁用自己的账号')
  if (patch.username !== undefined && patch.username !== row.username) {
    if (!USERNAME_RE.test(patch.username)) throw badRequest('用户名需为 3-32 位字母、数字或下划线')
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(patch.username, id)
    if (dup) throw conflict(`用户名「${patch.username}」已存在`)
  }
  const nextStatus = patch.status ?? row.status
  if (nextStatus === 'disabled' && isOwnerUser(db, id)) throw forbidden('owner 不可禁用')

  db.transaction(() => {
    db.prepare('UPDATE users SET display_name = ?, status = ?, username = ? WHERE id = ?').run(
      patch.displayName ?? row.display_name,
      nextStatus,
      patch.username ?? row.username,
      id,
    )
    if (nextStatus === 'disabled' && row.status === 'active') {
      destroyUserSessions(db, id)
      assertGovernanceRetained(db, id)
    }
  })()
  writeAudit(db, {
    userId: actor.userId,
    action: 'user.update',
    targetType: 'user',
    targetId: id,
    detail: patch,
    ip,
  })
  return getUser(db, id)
}

export function setUserRoles(db: Db, actor: Actor, id: string, roleIds: string[], ip: string): UserSummary {
  const row = loadRow(db, id)
  const targetIsOwner = isOwnerUser(db, id)
  assertOwnerGuard(actor, db, id, '修改')
  if (id === actor.userId && !actor.isOwner) {
    throw forbidden('不能为自己分配角色（防止自我提权），请联系 owner 操作')
  }
  const unique = validateRoleIds(db, roleIds)
  if (unique.length === 0) throw badRequest('至少保留一个角色')
  if (targetIsOwner) {
    if (!unique.includes(OWNER_ROLE_ID)) throw forbidden('owner 不可降级，必须保留 owner 角色')
  } else if (unique.includes(OWNER_ROLE_ID)) {
    throw forbidden('owner 全局唯一，不能把 owner 角色分配给其他账号')
  }
  assertCanGrant(actor, rolePermsUnion(db, unique))
  db.transaction(() => {
    assignRoles(db, id, unique)
    assertGovernanceRetained(db)
  })()
  writeAudit(db, {
    userId: actor.userId,
    action: 'user.set-roles',
    targetType: 'user',
    targetId: id,
    detail: { roleIds: unique, username: row.username },
    ip,
  })
  return getUser(db, id)
}

export function deleteUser(db: Db, actor: Actor, id: string, ip: string): void {
  const row = loadRow(db, id)
  if (id === actor.userId) throw forbidden('不能删除自己的账号')
  assertOwnerGuard(actor, db, id, '删除')
  if (isOwnerUser(db, id)) throw forbidden('owner 不可删除')
  db.transaction(() => {
    assertGovernanceRetained(db, id)
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
  })()
  writeAudit(db, {
    userId: actor.userId,
    action: 'user.delete',
    targetType: 'user',
    targetId: id,
    detail: { username: row.username },
    ip,
  })
}

export async function resetUserPassword(
  db: Db,
  actor: Actor,
  id: string,
  ip: string,
): Promise<{ initialPassword: string }> {
  loadRow(db, id)
  assertOwnerGuard(actor, db, id, '重置密码')
  const initialPassword = generateInitialPassword()
  const hash = await hashPassword(initialPassword)
  db.transaction(() => {
    db.prepare('UPDATE users SET pwd_hash = ?, must_change_pwd = 1 WHERE id = ?').run(hash, id)
    destroyUserSessions(db, id)
  })()
  writeAudit(db, {
    userId: actor.userId,
    action: 'user.reset-password',
    targetType: 'user',
    targetId: id,
    ip,
  })
  return { initialPassword }
}

export async function changeOwnPassword(
  db: Db,
  userId: string,
  oldPassword: string,
  newPassword: string,
  ip: string,
  keepToken?: string,
): Promise<void> {
  const row = loadRow(db, userId)
  const ok = await verifyPassword(row.pwd_hash, oldPassword)
  if (!ok) throw unauthorized('原密码不正确')
  const check = validatePasswordStrength(newPassword)
  if (!check.ok) throw badRequest(check.reason ?? '密码强度不足')
  if (oldPassword === newPassword) throw badRequest('新密码不能与原密码相同')
  const hash = await hashPassword(newPassword)
  db.prepare('UPDATE users SET pwd_hash = ?, must_change_pwd = 0 WHERE id = ?').run(hash, userId)
  destroyUserSessions(db, userId, keepToken)
  writeAudit(db, { userId, action: 'user.change-password', targetType: 'user', targetId: userId, ip })
}

/** 首次登录强制改密：不需要原密码（初始密码已用于登录）。 */
export async function finishInitialPassword(db: Db, userId: string, newPassword: string, ip: string): Promise<void> {
  const row = loadRow(db, userId)
  if (row.must_change_pwd !== 1) throw badRequest('当前账号无需强制改密')
  const check = validatePasswordStrength(newPassword)
  if (!check.ok) throw badRequest(check.reason ?? '密码强度不足')
  const hash = await hashPassword(newPassword)
  db.prepare('UPDATE users SET pwd_hash = ?, must_change_pwd = 0 WHERE id = ?').run(hash, userId)
  writeAudit(db, { userId, action: 'user.finish-initial-password', targetType: 'user', targetId: userId, ip })
}
