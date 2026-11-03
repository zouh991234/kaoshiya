import { ROLE_OWNER, missingPerms, normalizePerms } from '@kaoshiya/shared'
import type { Role } from '@kaoshiya/shared'
import type { Db } from '../db/index.js'
import { badRequest, conflict, forbidden, notFound } from '../errors.js'
import { newId, nowIso, safeJsonParse } from '../util.js'
import { writeAudit } from './audit.js'
import { computeUserPerms } from '../rbac/resolve.js'
import { PERMS } from '@kaoshiya/shared'

export interface Actor {
  userId: string
  isOwner: boolean
  perms: readonly string[]
}

interface RoleRow {
  id: string
  name: string
  description: string
  perms: string
  builtin: number
  sort_order: number
  created_at: string
  updated_at: string
}

function toRole(row: RoleRow, userCount?: number): Role {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    perms: safeJsonParse<string[]>(row.perms, []),
    builtin: row.builtin === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userCount,
  }
}

export function listRoles(db: Db): Role[] {
  const rows = db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
       FROM roles r ORDER BY r.builtin DESC, r.sort_order ASC, r.name ASC`,
    )
    .all() as (RoleRow & { user_count: number })[]
  return rows.map((row) => toRole(row, row.user_count))
}

export function getRole(db: Db, id: string): Role {
  const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as RoleRow | undefined
  if (!row) throw notFound('角色不存在')
  return toRole(row)
}

export function findRoleByName(db: Db, name: string): Role | null {
  const row = db.prepare('SELECT * FROM roles WHERE name = ?').get(name) as RoleRow | undefined
  return row ? toRole(row) : null
}

/** 不能授予自己没有的权限（owner 不受此限）。 */
export function assertCanGrant(actor: Actor, perms: readonly string[]): void {
  if (actor.isOwner) return
  const missing = missingPerms(actor.perms, perms)
  if (missing.length > 0) {
    throw forbidden(`不能授予自身不具备的权限：${missing.join('、')}`)
  }
}

/** 系统必须至少保留一个同时具备 role:write + user:update 的启用账号。 */
export function assertGovernanceRetained(db: Db, excludeUserId?: string): void {
  const users = db
    .prepare("SELECT id FROM users WHERE status = 'active' AND id <> ?")
    .all(excludeUserId ?? '') as { id: string }[]
  for (const user of users) {
    const { perms } = computeUserPerms(db, user.id)
    if (perms.includes(PERMS.ROLE_WRITE) && perms.includes(PERMS.USER_UPDATE)) return
  }
  throw conflict('操作被阻止：系统必须至少保留一个同时具备「角色管理」与「编辑用户」权限的启用账号')
}

function assertNameUnique(db: Db, name: string, exceptId?: string): void {
  const row = db.prepare('SELECT id FROM roles WHERE name = ?').get(name) as { id: string } | undefined
  if (row && row.id !== exceptId) throw conflict(`角色名「${name}」已存在`)
}

function assertNameValid(name: string): void {
  if (!/^[\w\u4e00-\u9fa5-]{2,24}$/.test(name)) {
    throw badRequest('角色名需为 2-24 位中文、字母、数字、下划线或短横线')
  }
}

export interface RoleInput {
  name: string
  description: string
  perms: string[]
}

export function createRole(db: Db, actor: Actor, input: RoleInput, ip: string): Role {
  assertNameValid(input.name)
  assertNameUnique(db, input.name)
  const perms = normalizePerms(input.perms)
  if (perms.length === 0) throw badRequest('角色至少需要一个权限点')
  assertCanGrant(actor, perms)
  const id = newId('role')
  const now = nowIso()
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM roles').get() as { m: number }
  db.prepare(
    `INSERT INTO roles (id, name, description, perms, builtin, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(id, input.name, input.description, JSON.stringify(perms), maxSort.m + 10, now, now)
  writeAudit(db, {
    userId: actor.userId,
    action: 'role.create',
    targetType: 'role',
    targetId: id,
    detail: { name: input.name, perms },
    ip,
  })
  return getRole(db, id)
}

export function updateRole(db: Db, actor: Actor, id: string, patch: Partial<RoleInput>, ip: string): Role {
  const role = getRole(db, id)
  if (role.name === ROLE_OWNER) {
    throw forbidden('owner 角色的权限恒为全集，不可编辑')
  }
  if (patch.name !== undefined && patch.name !== role.name) {
    if (role.builtin) throw forbidden('内置角色不可改名')
    assertNameValid(patch.name)
    assertNameUnique(db, patch.name, id)
  }
  const nextPerms = patch.perms ? normalizePerms(patch.perms) : role.perms
  if (nextPerms.length === 0) throw badRequest('角色至少需要一个权限点')
  if (patch.perms) assertCanGrant(actor, nextPerms)

  db.transaction(() => {
    db.prepare('UPDATE roles SET name = ?, description = ?, perms = ?, updated_at = ? WHERE id = ?').run(
      patch.name ?? role.name,
      patch.description ?? role.description,
      JSON.stringify(nextPerms),
      nowIso(),
      id,
    )
    if (patch.perms) assertGovernanceRetained(db)
  })()
  writeAudit(db, {
    userId: actor.userId,
    action: 'role.update',
    targetType: 'role',
    targetId: id,
    detail: { name: patch.name ?? role.name, perms: nextPerms },
    ip,
  })
  return getRole(db, id)
}

export function deleteRole(db: Db, actor: Actor, id: string, ip: string): void {
  const role = getRole(db, id)
  if (role.builtin) throw forbidden('内置角色不可删除')
  const count = db.prepare('SELECT COUNT(*) AS c FROM user_roles WHERE role_id = ?').get(id) as { c: number }
  if (count.c > 0) {
    throw conflict(`该角色仍被 ${count.c} 个用户占用，请先迁移这些用户的角色`)
  }
  db.prepare('DELETE FROM roles WHERE id = ?').run(id)
  writeAudit(db, {
    userId: actor.userId,
    action: 'role.delete',
    targetType: 'role',
    targetId: id,
    detail: { name: role.name },
    ip,
  })
}

export function duplicateRole(db: Db, actor: Actor, id: string, name: string, ip: string): Role {
  const role = getRole(db, id)
  return createRole(
    db,
    actor,
    { name, description: `${role.description}（副本）`, perms: role.perms },
    ip,
  )
}
