import type { Db } from '../db/index.js'
import { nowIso } from '../util.js'

export interface AuditInput {
  userId: string | null
  action: string
  targetType: string
  targetId?: string | null
  detail?: unknown
  ip?: string
}

/** 角色、权限、用户角色的任何变更都必须留痕。 */
export function writeAudit(db: Db, input: AuditInput): void {
  const detail = typeof input.detail === 'string' ? input.detail : JSON.stringify(input.detail ?? {})
  db.prepare(
    'INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, ip, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    input.userId,
    input.action,
    input.targetType,
    input.targetId ?? null,
    detail.slice(0, 4000),
    input.ip ?? '',
    nowIso(),
  )
}
