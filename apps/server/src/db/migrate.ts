import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Db } from './index.js'
import { nowIso } from '../util.js'
import { BUILTIN_ROLES, ROLE_OWNER } from '@kaoshiya/shared'
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from '@kaoshiya/shared'

const here = path.dirname(fileURLToPath(import.meta.url))

export function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(here, '../../migrations'),
    path.resolve(here, '../migrations'),
    path.resolve(process.cwd(), 'migrations'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`找不到 migrations 目录，已尝试：${candidates.join(' | ')}`)
}

export function migrate(db: Db, migrationsDir = resolveMigrationsDir()): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => (row as { version: string }).version),
  )
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    const run = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, nowIso())
    })
    run()
  }
}

/** 内置角色与默认设置：幂等，可重复执行。 */
export function ensureBaseline(db: Db): void {
  const insertRole = db.prepare(
    `INSERT INTO roles (id, name, description, perms, builtin, sort_order, created_at, updated_at)
     VALUES (@id, @name, @description, @perms, 1, @sortOrder, @createdAt, @updatedAt)`,
  )
  const existing = new Set(
    db.prepare('SELECT name FROM roles').all().map((row) => (row as { name: string }).name),
  )
  const now = nowIso()
  db.transaction(() => {
    BUILTIN_ROLES.forEach((role, index) => {
      if (existing.has(role.name)) return
      insertRole.run({
        id: `role_${role.name}`,
        name: role.name,
        description: role.description,
        perms: JSON.stringify(role.perms),
        sortOrder: index * 10,
        createdAt: now,
        updatedAt: now,
      })
    })
    const putSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    putSetting.run(SETTINGS_KEYS.SITE_NAME, JSON.stringify(DEFAULT_SETTINGS.siteName))
    putSetting.run(SETTINGS_KEYS.DEFAULT_PASS_SCORE, JSON.stringify(DEFAULT_SETTINGS.defaultPassScore))
    putSetting.run(SETTINGS_KEYS.GUEST_ENABLED, JSON.stringify(DEFAULT_SETTINGS.guestEnabled))
  })()
}

export function ownerExists(db: Db): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE r.name = ? LIMIT 1`,
    )
    .get(ROLE_OWNER)
  return Boolean(row)
}
