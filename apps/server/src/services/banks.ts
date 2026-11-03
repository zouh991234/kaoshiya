import { PERMS } from '@kaoshiya/shared'
import type { Bank, BankSummary, BankVisibility, Chapter } from '@kaoshiya/shared'
import type { Db } from '../db/index.js'
import { badRequest, conflict, forbidden, notFound } from '../errors.js'
import { newId, nowIso } from '../util.js'
import { writeAudit } from './audit.js'
import type { Actor } from './roles.js'
import { deleteUnreferencedMedia } from './media.js'

interface BankRow {
  id: string
  name: string
  subject: string
  description: string
  visibility: BankVisibility
  owner_id: string
  created_at: string
  updated_at: string
}

function toBank(row: BankRow): Bank {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    description: row.description,
    visibility: row.visibility,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 可见性：public 全员（已登录）可见，private 仅归属者与具备 bank:update 的管理者可见。 */
export function canSeeBank(actor: Actor, bank: Bank): boolean {
  if (bank.visibility === 'public') return true
  if (bank.ownerId === actor.userId) return true
  return actor.perms.includes(PERMS.BANK_UPDATE)
}

export function canManageBank(actor: Actor, bank: Bank): boolean {
  if (actor.isOwner) return true
  if (actor.perms.includes(PERMS.BANK_DELETE)) return true
  return bank.ownerId === actor.userId
}

function loadRow(db: Db, bankId: string): BankRow {
  const row = db.prepare('SELECT * FROM banks WHERE id = ?').get(bankId) as BankRow | undefined
  if (!row) throw notFound('题库不存在')
  return row
}

export function getBank(db: Db, bankId: string): Bank {
  return toBank(loadRow(db, bankId))
}

export function assertBankVisible(db: Db, actor: Actor, bankId: string): Bank {
  const bank = getBank(db, bankId)
  if (!canSeeBank(actor, bank)) throw forbidden('无权访问该题库')
  return bank
}

export function assertBankManageable(db: Db, actor: Actor, bankId: string): Bank {
  const bank = getBank(db, bankId)
  if (!canManageBank(actor, bank)) throw forbidden('只能管理自己创建的题库')
  return bank
}

export interface ListBanksQuery {
  keyword?: string
  page?: number
  pageSize?: number
}

export function listBanks(
  db: Db,
  auth: { userId: string; perms: readonly string[] },
  query: ListBanksQuery = {},
): { items: BankSummary[]; total: number } {
  const where: string[] = []
  const params: unknown[] = []
  const canSeeAll = auth.perms.includes(PERMS.BANK_UPDATE)
  if (!canSeeAll) {
    where.push("(b.visibility = 'public' OR b.owner_id = ?)")
    params.push(auth.userId)
  }
  if (query.keyword) {
    where.push('(b.name LIKE ? OR b.subject LIKE ? OR b.description LIKE ?)')
    const like = `%${query.keyword}%`
    params.push(like, like, like)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50))
  const total = db.prepare(`SELECT COUNT(*) AS c FROM banks b ${clause}`).get(...params) as { c: number }
  const rows = db
    .prepare(
      `SELECT b.*,
        (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS question_count,
        (SELECT COUNT(*) FROM chapters c2 WHERE c2.bank_id = b.id) AS chapter_count,
        (SELECT COUNT(*) FROM progress p JOIN questions q ON q.id = p.question_id
           WHERE q.bank_id = b.id AND p.user_id = ? AND p.seen > 0) AS seen_count,
        (SELECT COUNT(*) FROM progress p JOIN questions q ON q.id = p.question_id
           WHERE q.bank_id = b.id AND p.user_id = ? AND p.last_result = 'right') AS right_count,
        (SELECT COUNT(*) FROM progress p JOIN questions q ON q.id = p.question_id
           WHERE q.bank_id = b.id AND p.user_id = ? AND p.last_result = 'wrong') AS wrong_count,
        (SELECT COUNT(*) FROM progress p JOIN questions q ON q.id = p.question_id
           WHERE q.bank_id = b.id AND p.user_id = ? AND p.favorite = 1) AS favorite_count,
        (SELECT MAX(p.last_at) FROM progress p JOIN questions q ON q.id = p.question_id
           WHERE q.bank_id = b.id AND p.user_id = ?) AS last_studied_at
       FROM banks b ${clause}
       ORDER BY b.updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(
      auth.userId,
      auth.userId,
      auth.userId,
      auth.userId,
      auth.userId,
      ...params,
      pageSize,
      (page - 1) * pageSize,
    ) as (BankRow & {
    question_count: number
    chapter_count: number
    seen_count: number
    right_count: number
    wrong_count: number
    favorite_count: number
    last_studied_at: string | null
  })[]
  const typeRows = db
    .prepare('SELECT bank_id, type, COUNT(*) AS c FROM questions GROUP BY bank_id, type')
    .all() as { bank_id: string; type: string; c: number }[]
  const typeMap = new Map<string, Record<string, number>>()
  for (const row of typeRows) {
    const entry = typeMap.get(row.bank_id) ?? {}
    entry[row.type] = row.c
    typeMap.set(row.bank_id, entry)
  }
  const emptyByType = { single: 0, multiple: 0, judge: 0, blank: 0, essay: 0 }

  return {
    items: rows.map((row) => ({
      ...toBank(row),
      byType: { ...emptyByType, ...(typeMap.get(row.id) ?? {}) },
      questionCount: row.question_count,
      chapterCount: row.chapter_count,
      seenCount: row.seen_count,
      rightCount: row.right_count,
      wrongCount: row.wrong_count,
      favoriteCount: row.favorite_count,
      lastStudiedAt: row.last_studied_at,
    })),
    total: total.c,
  }
}

export interface BankInput {
  name: string
  subject?: string
  description?: string
  visibility?: BankVisibility
}

export function createBank(db: Db, actor: Actor, input: BankInput, ip: string): Bank {
  const name = input.name.trim()
  if (!name) throw badRequest('题库名称不能为空')
  const id = newId('bank')
  const now = nowIso()
  db.prepare(
    `INSERT INTO banks (id, name, subject, description, visibility, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, input.subject ?? '', input.description ?? '', input.visibility ?? 'private', actor.userId, now, now)
  writeAudit(db, { userId: actor.userId, action: 'bank.create', targetType: 'bank', targetId: id, detail: { name }, ip })
  return getBank(db, id)
}

export function updateBank(db: Db, actor: Actor, bankId: string, patch: Partial<BankInput>, ip: string): Bank {
  const bank = assertBankManageable(db, actor, bankId)
  const name = patch.name?.trim()
  if (name !== undefined && !name) throw badRequest('题库名称不能为空')
  db.prepare('UPDATE banks SET name = ?, subject = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ?').run(
    name ?? bank.name,
    patch.subject ?? bank.subject,
    patch.description ?? bank.description,
    patch.visibility ?? bank.visibility,
    nowIso(),
    bankId,
  )
  writeAudit(db, { userId: actor.userId, action: 'bank.update', targetType: 'bank', targetId: bankId, detail: patch, ip })
  return getBank(db, bankId)
}

export function deleteBank(db: Db, actor: Actor, bankId: string, ip: string, mediaDir: string): void {
  const bank = getBank(db, bankId)
  if (!actor.perms.includes(PERMS.BANK_DELETE)) throw forbidden('缺少权限：bank:delete')
  const mediaHashes = db
    .prepare('SELECT media FROM questions WHERE bank_id = ?')
    .all(bankId) as { media: string }[]
  db.transaction(() => {
    db.prepare('DELETE FROM exam_records WHERE bank_id = ?').run(bankId)
    db.prepare('DELETE FROM exam_configs WHERE bank_id = ?').run(bankId)
    db.prepare('DELETE FROM questions WHERE bank_id = ?').run(bankId)
    db.prepare('DELETE FROM chapters WHERE bank_id = ?').run(bankId)
    db.prepare('DELETE FROM banks WHERE id = ?').run(bankId)
  })()
  const candidates: string[] = []
  for (const row of mediaHashes) {
    try {
      const list = JSON.parse(row.media) as { hash?: string }[]
      for (const item of list) if (item.hash) candidates.push(item.hash)
    } catch {
      // 历史上损坏的媒体字段忽略，不影响删除
    }
  }
  deleteUnreferencedMedia(db, mediaDir, candidates)
  writeAudit(db, {
    userId: actor.userId,
    action: 'bank.delete',
    targetType: 'bank',
    targetId: bankId,
    detail: { name: bank.name },
    ip,
  })
}

export function listChapters(db: Db, bankId: string): Chapter[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.bank_id, c.name, c.sort_order,
        (SELECT COUNT(*) FROM questions q WHERE q.chapter_id = c.id) AS question_count
       FROM chapters c WHERE c.bank_id = ? ORDER BY c.sort_order ASC, c.name ASC`,
    )
    .all(bankId) as { id: string; bank_id: string; name: string; sort_order: number; question_count: number }[]
  return rows.map((row) => ({
    id: row.id,
    bankId: row.bank_id,
    name: row.name,
    sortOrder: row.sort_order,
    questionCount: row.question_count,
  }))
}

export function ensureChapter(db: Db, bankId: string, name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw badRequest('章节名不能为空')
  const existing = db.prepare('SELECT id FROM chapters WHERE bank_id = ? AND name = ?').get(bankId, trimmed) as
    | { id: string }
    | undefined
  if (existing) return existing.id
  const id = newId('ch')
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM chapters WHERE bank_id = ?').get(bankId) as {
    m: number
  }
  db.prepare('INSERT INTO chapters (id, bank_id, name, sort_order) VALUES (?, ?, ?, ?)').run(
    id,
    bankId,
    trimmed,
    max.m + 10,
  )
  return id
}

export function assertBankExists(db: Db, bankId: string): void {
  const row = db.prepare('SELECT id FROM banks WHERE id = ?').get(bankId)
  if (!row) throw notFound('题库不存在')
}

export function assertBankNameUnique(db: Db, name: string, exceptId?: string): void {
  const row = db.prepare('SELECT id FROM banks WHERE name = ?').get(name) as { id: string } | undefined
  if (row && row.id !== exceptId) throw conflict(`题库名称「${name}」已存在`)
}
