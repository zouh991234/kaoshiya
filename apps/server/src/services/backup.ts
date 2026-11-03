import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db/index.js'
import type { AppConfig } from '../config.js'
import { openDatabase } from '../db/index.js'
import { badRequest, notFound } from '../errors.js'
import { nowIso } from '../util.js'

export interface BackupManifest {
  format: 'kaoshiya-backup'
  version: 1
  id: string
  createdAt: string
  counts: { users: number; banks: number; questions: number; exams: number }
  mediaFiles: number
  databaseBytes: number
}

const RETAIN = 7

function backupRoot(config: AppConfig): string {
  return path.join(config.backupDir)
}

export function listBackups(config: AppConfig): BackupManifest[] {
  const root = backupRoot(config)
  if (!fs.existsSync(root)) return []
  const out: BackupManifest[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = path.join(root, entry.name, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue
    try {
      out.push(JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest)
    } catch {
      // 损坏的清单跳过，不影响其他备份
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

function counts(db: Db): BackupManifest['counts'] {
  const row = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM banks) AS banks,
              (SELECT COUNT(*) FROM questions) AS questions,
              (SELECT COUNT(*) FROM exam_records) AS exams`,
    )
    .get() as { users: number; banks: number; questions: number; exams: number }
  return row
}

/**
 * SQLite 一致性备份：使用 better-sqlite3 的在线备份 API（等价于 sqlite3_backup），
 * 不是直接复制正在写入的数据库文件。媒体目录在备份期间与本服务串行访问。
 */
export async function createBackup(db: Db, config: AppConfig): Promise<BackupManifest> {
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(backupRoot(config), id)
  fs.mkdirSync(dir, { recursive: true })
  const dbTarget = path.join(dir, 'kaoshiya.db')
  await db.backup(dbTarget)
  const mediaTarget = path.join(dir, 'media')
  let mediaFiles = 0
  if (fs.existsSync(config.mediaDir)) {
    fs.cpSync(config.mediaDir, mediaTarget, { recursive: true })
    mediaFiles = fs.readdirSync(mediaTarget).filter((f) => fs.statSync(path.join(mediaTarget, f)).isFile()).length
  } else {
    fs.mkdirSync(mediaTarget, { recursive: true })
  }
  const manifest: BackupManifest = {
    format: 'kaoshiya-backup',
    version: 1,
    id,
    createdAt: nowIso(),
    counts: counts(db),
    mediaFiles,
    databaseBytes: fs.statSync(dbTarget).size,
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  pruneBackups(config)
  return manifest
}

export function pruneBackups(config: AppConfig): void {
  const list = listBackups(config)
  for (const stale of list.slice(RETAIN)) {
    fs.rmSync(path.join(backupRoot(config), stale.id), { recursive: true, force: true })
  }
}

export function deleteBackup(config: AppConfig, id: string): void {
  if (!/^[\w:.\-]+$/.test(id)) throw badRequest('备份 ID 不合法')
  const dir = path.join(backupRoot(config), id)
  if (!fs.existsSync(dir)) throw notFound('备份不存在')
  fs.rmSync(dir, { recursive: true, force: true })
}

export interface RestoreResult {
  restoredId: string
  preRestoreCopy: string
  mediaFiles: number
}

/**
 * 恢复：先校验备份包结构与数据库完整性，再把当前库另存为 pre-restore 副本，
 * 最后替换数据库与媒体目录。调用方负责随后重启进程（SQLite 文件已被替换）。
 */
export async function restoreBackup(
  db: Db,
  config: AppConfig,
  id: string,
): Promise<RestoreResult> {
  if (!/^[\w:.\-]+$/.test(id)) throw badRequest('备份 ID 不合法')
  const dir = path.join(backupRoot(config), id)
  if (!fs.existsSync(dir)) throw notFound('备份不存在')
  const manifestPath = path.join(dir, 'manifest.json')
  const sourceDb = path.join(dir, 'kaoshiya.db')
  if (!fs.existsSync(manifestPath) || !fs.existsSync(sourceDb)) {
    throw badRequest('备份包结构不完整：缺少 manifest.json 或数据库文件')
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest
  if (manifest.format !== 'kaoshiya-backup' || manifest.version !== 1) {
    throw badRequest('备份包格式或版本不受支持')
  }

  const probe = openDatabase(sourceDb)
  try {
    const integrity = probe.pragma('integrity_check') as { integrity_check: string }[]
    if (!integrity.every((row) => row.integrity_check === 'ok')) throw badRequest('备份数据库完整性校验失败')
    const hasUsers = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()
    if (!hasUsers) throw badRequest('备份数据库缺少 users 表，可能不是本系统的备份')
    const migrations = probe.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number }
    if (migrations.c === 0) throw badRequest('备份数据库缺少迁移记录')
  } finally {
    probe.close()
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const preRestoreDir = path.join(backupRoot(config), `pre-restore-${stamp}`)
  fs.mkdirSync(preRestoreDir, { recursive: true })
  const preRestoreFile = path.join(preRestoreDir, 'kaoshiya.db')
  await db.backup(preRestoreFile)
  fs.writeFileSync(
    path.join(preRestoreDir, 'manifest.json'),
    JSON.stringify({ format: 'kaoshiya-backup', version: 1, id: `pre-restore-${stamp}`, createdAt: nowIso(), note: '恢复前自动快照' }, null, 2),
  )

  db.pragma('wal_checkpoint(TRUNCATE)')
  db.close()
  for (const suffix of ['-wal', '-shm']) {
    const file = `${config.databasePath}${suffix}`
    if (fs.existsSync(file)) fs.rmSync(file, { force: true })
  }
  fs.copyFileSync(sourceDb, config.databasePath)
  const mediaSource = path.join(dir, 'media')
  if (fs.existsSync(mediaSource)) {
    fs.rmSync(config.mediaDir, { recursive: true, force: true })
    fs.cpSync(mediaSource, config.mediaDir, { recursive: true })
  }
  return {
    restoredId: id,
    preRestoreCopy: preRestoreDir,
    mediaFiles: fs.existsSync(config.mediaDir) ? fs.readdirSync(config.mediaDir).length : 0,
  }
}

/** 全量数据导出：题库 + 题目 + 章节 + 组卷规则 + 用户与角色（不含密码哈希）。 */
export function exportAllData(db: Db): Record<string, unknown> {
  const banks = db.prepare('SELECT * FROM banks').all()
  const chapters = db.prepare('SELECT * FROM chapters').all()
  const questions = db.prepare('SELECT * FROM questions').all()
  const examConfigs = db.prepare('SELECT * FROM exam_configs').all()
  const users = db
    .prepare('SELECT id, username, display_name, status, created_at, last_login_at FROM users')
    .all()
  const roles = db.prepare('SELECT * FROM roles').all()
  const userRoles = db.prepare('SELECT * FROM user_roles').all()
  return {
    format: 'kaoshiya-export',
    version: 1,
    exportedAt: nowIso(),
    banks,
    chapters,
    questions,
    examConfigs,
    users,
    roles,
    userRoles,
  }
}
