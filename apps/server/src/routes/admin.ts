import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PERMS } from '@kaoshiya/shared'
import { requirePerm } from '../auth/guard.js'
import { badRequest, notFound } from '../errors.js'
import { getSettings, setSettings } from '../services/settings.js'
import { statsAll } from '../services/stats.js'
import { createBackup, deleteBackup, exportAllData, listBackups, restoreBackup } from '../services/backup.js'
import { writeAudit } from '../services/audit.js'
import { createBank, ensureChapter } from '../services/banks.js'
import { importBatch } from '../services/import.js'
import { actorOf } from './users.js'
import { newId } from '../util.js'

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/overview', { preHandler: requirePerm(PERMS.STATS_ALL) }, async () => {
    const all = statsAll(app.db, {
      databasePath: app.appConfig.databasePath,
      mediaDir: app.appConfig.mediaDir,
      backupDir: app.appConfig.backupDir,
    })
    const roleCount = app.db.prepare('SELECT COUNT(*) AS c FROM roles').get() as { c: number }
    return { ...all, roleCount: roleCount.c, backups: listBackups(app.appConfig).length }
  })

  app.get('/audit', { preHandler: requirePerm(PERMS.AUDIT_READ) }, async (request) => {
    const query = z
      .object({
        keyword: z.string().max(80).optional(),
        userId: z.string().optional(),
        targetType: z.string().max(40).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(request.query)
    const where: string[] = []
    const params: unknown[] = []
    if (query.keyword) {
      where.push('(a.action LIKE ? OR a.detail LIKE ?)')
      params.push(`%${query.keyword}%`, `%${query.keyword}%`)
    }
    if (query.userId) {
      where.push('a.user_id = ?')
      params.push(query.userId)
    }
    if (query.targetType) {
      where.push('a.target_type = ?')
      params.push(query.targetType)
    }
    if (query.from) {
      where.push('a.at >= ?')
      params.push(query.from)
    }
    if (query.to) {
      where.push('a.at <= ?')
      params.push(query.to)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50))
    const total = app.db.prepare(`SELECT COUNT(*) AS c FROM audit_logs a ${clause}`).get(...params) as { c: number }
    const rows = app.db
      .prepare(
        `SELECT a.id, a.user_id, u.display_name AS user_name, a.action, a.target_type, a.target_id, a.detail, a.ip, a.at
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${clause}
         ORDER BY a.at DESC, a.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize)
    return { items: rows, total: total.c }
  })

  app.get('/settings', { preHandler: requirePerm(PERMS.SETTINGS_READ) }, async () => getSettings(app.db))

  app.put('/settings', { preHandler: requirePerm(PERMS.SETTINGS_WRITE) }, async (request) => {
    const body = z
      .object({
        siteName: z.string().min(1).max(40).optional(),
        defaultPassScore: z.number().min(0).max(1000).optional(),
        guestEnabled: z.boolean().optional(),
      })
      .parse(request.body)
    const next = setSettings(app.db, body)
    writeAudit(app.db, {
      userId: request.auth!.userId,
      action: 'settings.update',
      targetType: 'settings',
      targetId: null,
      detail: body,
      ip: request.ip,
    })
    return next
  })

  app.get('/backups', { preHandler: requirePerm(PERMS.DATA_BACKUP) }, async () => ({
    items: listBackups(app.appConfig),
  }))

  app.post(
    '/backup',
    { preHandler: requirePerm(PERMS.DATA_BACKUP), config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const manifest = await createBackup(app.db, app.appConfig)
      writeAudit(app.db, {
        userId: request.auth!.userId,
        action: 'data.backup',
        targetType: 'backup',
        targetId: manifest.id,
        detail: manifest.counts,
        ip: request.ip,
      })
      reply.code(201)
      return manifest
    },
  )

  app.delete('/backups/:id', { preHandler: requirePerm(PERMS.DATA_BACKUP) }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params)
    deleteBackup(app.appConfig, params.id)
    writeAudit(app.db, {
      userId: request.auth!.userId,
      action: 'data.backup.delete',
      targetType: 'backup',
      targetId: params.id,
      ip: request.ip,
    })
    return { ok: true }
  })

  app.post('/backup/restore', { preHandler: requirePerm(PERMS.DATA_BACKUP) }, async (request) => {
    const body = z.object({ id: z.string().min(1), confirm: z.string().min(1) }).parse(request.body)
    if (body.confirm !== body.id) throw badRequest('请输入完整备份 ID 以确认恢复')
    const result = await restoreBackup(app.db, app.appConfig, body.id)
    request.log.warn({ result }, 'restore finished, restarting process')
    setTimeout(() => process.exit(0), 300)
    return { ok: true, ...result, restarting: true }
  })

  app.get(
    '/data/export',
    { preHandler: requirePerm(PERMS.DATA_EXPORT), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const data = exportAllData(app.db)
      writeAudit(app.db, {
        userId: request.auth!.userId,
        action: 'data.export',
        targetType: 'data',
        targetId: null,
        detail: {},
        ip: request.ip,
      })
      reply.header('Content-Disposition', `attachment; filename="kaoshiya-export.json"`)
      reply.type('application/json; charset=utf-8')
      return data
    },
  )

  /** 导入题库 JSON（bank 级导出），落到新题库，不影响既有数据。 */
  app.post(
    '/data/import',
    { preHandler: requirePerm(PERMS.DATA_IMPORT), bodyLimit: 8 * 1024 * 1024 },
    async (request, reply) => {
      const body = z
        .object({
          bank: z.object({ name: z.string().min(1).max(80), subject: z.string().optional(), description: z.string().optional() }),
          questions: z.array(z.record(z.unknown())).min(1),
        })
        .parse(request.body)
      const bank = createBank(app.db, actorOf(request), { name: body.bank.name, subject: body.bank.subject ?? '', description: body.bank.description ?? '', visibility: 'private' }, request.ip)
      const chapters = new Set<string>()
      for (const raw of body.questions) {
        const chapter = (raw as { chapterName?: unknown }).chapterName
        if (typeof chapter === 'string' && chapter.trim()) chapters.add(chapter.trim())
      }
      for (const name of chapters) ensureChapter(app.db, bank.id, name)
      const total = importBatch(
        app.db,
        actorOf(request),
        bank.id,
        {
          importId: newId('imp'),
          batchIndex: 0,
          batchCount: 1,
          chapters: [...chapters],
          questions: body.questions as never,
        },
        request.ip,
      )
      reply.code(201)
      return { bankId: bank.id, imported: total.imported }
    },
  )

  app.get('/admin/audit-meta', { preHandler: requirePerm(PERMS.AUDIT_READ) }, async () => {
    const row = app.db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as { c: number }
    if (!row) throw notFound('无数据')
    return { total: row.c }
  })
}
