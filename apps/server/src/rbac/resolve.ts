import { ALL_PERMS, ROLE_OWNER, normalizePerms } from '@kaoshiya/shared'
import type { UserStatus } from '@kaoshiya/shared'
import type { Db } from '../db/index.js'
import { safeJsonParse } from '../util.js'

export interface AuthContext {
  userId: string
  username: string
  displayName: string
  status: UserStatus
  mustChangePwd: boolean
  roles: string[]
  roleIds: string[]
  perms: string[]
  isOwner: boolean
  sessionToken: string
}

interface CacheEntry {
  roles: string[]
  roleIds: string[]
  perms: string[]
  isOwner: boolean
  at: number
}

const CACHE_TTL_MS = 30_000

/** 不走缓存地计算某用户权限（用于变更前的高危校验）。 */
export function computeUserPerms(
  db: Db,
  userId: string,
): { roles: string[]; roleIds: string[]; perms: string[]; isOwner: boolean } {
  const rows = db
    .prepare(
      `SELECT r.id AS id, r.name AS name, r.perms AS perms
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?`,
    )
    .all(userId) as { id: string; name: string; perms: string }[]
  const roles = rows.map((row) => row.name)
  const roleIds = rows.map((row) => row.id)
  const isOwner = roles.includes(ROLE_OWNER)
  const union = new Set<string>()
  for (const row of rows) {
    for (const perm of safeJsonParse<string[]>(row.perms, [])) union.add(perm)
  }
  return { roles, roleIds, perms: isOwner ? [...ALL_PERMS] : normalizePerms([...union]), isOwner }
}

/**
 * 权限解析：请求内一次 join `user_roles → roles` 求并集，owner 短路为全集。
 * 结果按 userId 缓存，角色 / 分配 / 用户状态变更时精准失效。
 */
export class PermResolver {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly db: Db) {}

  resolve(userId: string): Omit<AuthContext, 'userId' | 'username' | 'displayName' | 'status' | 'mustChangePwd' | 'sessionToken'> {
    const cached = this.cache.get(userId)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { roles: cached.roles, roleIds: cached.roleIds, perms: cached.perms, isOwner: cached.isOwner }
    }
    const computed = computeUserPerms(this.db, userId)
    const entry: CacheEntry = { ...computed, at: Date.now() }
    this.cache.set(userId, entry)
    return { roles: entry.roles, roleIds: entry.roleIds, perms: entry.perms, isOwner: entry.isOwner }
  }

  invalidate(userId: string): void {
    this.cache.delete(userId)
  }

  invalidateAll(): void {
    this.cache.clear()
  }

  /** 角色权限点变更：让所有挂该角色的用户缓存失效。 */
  invalidateRole(roleId: string): void {
    const users = this.db.prepare('SELECT user_id FROM user_roles WHERE role_id = ?').all(roleId) as {
      user_id: string
    }[]
    for (const row of users) this.cache.delete(row.user_id)
  }
}
