import { SESSION_TTL_MS } from '@kaoshiya/shared'
import type { Db } from '../db/index.js'
import { nowIso, randomToken } from '../util.js'

export interface SessionInfo {
  userId: string
  token: string
  expiresAt: string
}

/** 剩余有效期不足 12 小时时顺延，避免每个请求都写库。 */
const SLIDING_THRESHOLD_MS = 12 * 60 * 60 * 1000

export function createSession(db: Db, userId: string, ua: string, ip: string): SessionInfo {
  const token = randomToken(32)
  const now = nowIso()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, ua, ip) VALUES (?, ?, ?, ?, ?, ?)').run(
    token,
    userId,
    now,
    expiresAt,
    ua.slice(0, 255),
    ip.slice(0, 64),
  )
  return { userId, token, expiresAt }
}

export function readSession(db: Db, token: string): SessionInfo | null {
  const row = db.prepare('SELECT token, user_id, expires_at FROM sessions WHERE token = ?').get(token) as
    | { token: string; user_id: string; expires_at: string }
    | undefined
  if (!row) return null
  const expiresAt = new Date(row.expires_at).getTime()
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  if (expiresAt - Date.now() < SLIDING_THRESHOLD_MS) {
    const next = new Date(Date.now() + SESSION_TTL_MS).toISOString()
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(next, token)
    return { userId: row.user_id, token, expiresAt: next }
  }
  return { userId: row.user_id, token, expiresAt: row.expires_at }
}

export function destroySession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function destroyUserSessions(db: Db, userId: string, exceptToken?: string): void {
  if (exceptToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, exceptToken)
    return
  }
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function purgeExpiredSessions(db: Db): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso())
}
