import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import type { AppConfig } from '../src/config.js'
import { resetLoginGuard } from '../src/auth/login-guard.js'

const ORIGIN = 'http://127.0.0.1:20260'
let app: FastifyInstance
let tempDir: string
let config: AppConfig

let ownerCookie = ''
let adminCookie = ''
let memberCookie = ''
let bankId = ''
let adminInitial = ''
let memberInitial = ''

interface InjectOptions {
  body?: unknown
  cookie?: string
  origin?: string | null
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: InjectOptions = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { accept: 'application/json' }
  const origin = options.origin === undefined ? ORIGIN : options.origin
  if (origin) headers.origin = origin
  if (options.cookie) headers.cookie = options.cookie
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  const response = await app.inject({
    method,
    url,
    headers,
    payload: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(response.body) as Record<string, unknown>
  } catch {
    json = { raw: response.body }
  }
  return { status: response.statusCode, json }
}

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie']
  const list = Array.isArray(raw) ? raw : [raw]
  for (const item of list) {
    if (typeof item === 'string' && item.startsWith('kaoshiya_session=')) {
      return item.split(';')[0] ?? ''
    }
  }
  return ''
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaoshiya-test-'))
  config = {
    port: 0,
    host: '127.0.0.1',
    databasePath: path.join(tempDir, 'test.db'),
    dataDir: tempDir,
    mediaDir: path.join(tempDir, 'media'),
    backupDir: path.join(tempDir, 'backups'),
    publicOrigin: ORIGIN,
    secureCookie: false,
    logLevel: 'silent',
    webRoot: path.join(tempDir, 'web'),
    isProduction: false,
    trustProxy: false,
  }
  app = await buildApp({ config, logger: false })
  await app.ready()
})

afterAll(async () => {
  await app.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('初始化与认证', () => {
  it('首次访问 /setup 可以创建 owner', async () => {
    const status = await call('GET', '/api/setup/status')
    expect(status.json.initialized).toBe(false)

    const created = await call('POST', '/api/setup', {
      body: { username: 'owner', displayName: '站长', password: 'OwnerPass123' },
    })
    expect(created.status).toBe(200)
    const me = created.json as { user: { username: string }; isOwner: boolean; perms: string[] }
    expect(me.user.username).toBe('owner')
    expect(me.isOwner).toBe(true)
    expect(me.perms).toContain('role:write')
  })

  it('初始化后 /setup 返回 404', async () => {
    const again = await call('POST', '/api/setup', {
      body: { username: 'hacker', password: 'AnotherPass123' },
    })
    expect(again.status).toBe(404)
  })

  it('未登录访问受保护接口返回 401', async () => {
    const response = await call('GET', '/api/me')
    expect(response.status).toBe(401)
  })

  it('缺少 Origin 的写请求被 CSRF 校验拒绝', async () => {
    const response = await call('POST', '/api/auth/login', {
      body: { username: 'owner', password: 'OwnerPass123' },
      origin: null,
    })
    expect(response.status).toBe(403)
    expect(response.json.code).toBe('CSRF_FORBIDDEN')
  })

  it('错误密码返回统一提示，不区分账号是否存在', async () => {
    const response = await call('POST', '/api/auth/login', { body: { username: 'owner', password: 'wrong-pass' } })
    expect(response.status).toBe(401)
    expect(String(response.json.message)).toBe('用户名或密码不正确')
  })

  it('正确密码可以登录并拿到会话 Cookie', async () => {
    resetLoginGuard()
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'owner', password: 'OwnerPass123' }),
    })
    expect(response.statusCode).toBe(200)
    ownerCookie = cookieOf(response as unknown as { headers: Record<string, unknown> })
    expect(ownerCookie).toContain('kaoshiya_session=')
  })
})

describe('用户与角色护栏', () => {
  it('owner 可以创建 admin 与 member 账号', async () => {
    const roles = await call('GET', '/api/roles', { cookie: ownerCookie })
    const list = roles.json.items as { id: string; name: string }[]
    const adminRole = list.find((role) => role.name === 'admin')
    const memberRole = list.find((role) => role.name === 'member')
    expect(adminRole && memberRole).toBeTruthy()

    const admin = await call('POST', '/api/users', {
      cookie: ownerCookie,
      body: { username: 'admin1', displayName: '管理员', roleIds: [adminRole?.id] },
    })
    expect(admin.status).toBe(201)
    const member = await call('POST', '/api/users', {
      cookie: ownerCookie,
      body: { username: 'member1', displayName: '成员', roleIds: [memberRole?.id] },
    })
    expect(member.status).toBe(201)

    adminInitial = String((admin.json as { initialPassword: string }).initialPassword)
    memberInitial = String((member.json as { initialPassword: string }).initialPassword)
    expect(adminInitial).toBeTruthy()
    expect(memberInitial).toBeTruthy()
  })

  it('新账号带 mustChangePwd，首次登录后要先改密', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'admin1', password: adminInitial }),
    })
    expect(login.statusCode).toBe(200)
    adminCookie = cookieOf(login as unknown as { headers: Record<string, unknown> })
    const body = JSON.parse(login.body) as { user: { mustChangePwd: boolean } }
    expect(body.user.mustChangePwd).toBe(true)

    const blocked = await call('GET', '/api/users', { cookie: adminCookie })
    expect(blocked.status).toBe(403)
    expect(blocked.json.code).toBe('PASSWORD_CHANGE_REQUIRED')

    const changed = await call('POST', '/api/me/finish-initial-password', {
      cookie: adminCookie,
      body: { newPassword: 'AdminPass123' },
    })
    expect(changed.status).toBe(200)

    const allowed = await call('GET', '/api/users', { cookie: adminCookie })
    expect(allowed.status).toBe(200)
  })

  it('admin 不能删除 owner 账号', async () => {
    const users = await call('GET', '/api/users', { cookie: ownerCookie })
    const list = users.json.items as { id: string; username: string }[]
    const owner = list.find((user) => user.username === 'owner')
    expect(owner).toBeTruthy()
    const response = await call('DELETE', `/api/users/${owner?.id}`, { cookie: adminCookie })
    expect(response.status).toBe(403)
  })

  it('admin 不能把 owner 角色分配给别人（owner 唯一）', async () => {
    const roles = await call('GET', '/api/roles', { cookie: ownerCookie })
    const ownerRole = (roles.json.items as { id: string; name: string }[]).find((role) => role.name === 'owner')
    const users = await call('GET', '/api/users', { cookie: ownerCookie })
    const member = (users.json.items as { id: string; username: string }[]).find((user) => user.username === 'member1')
    const response = await call('PUT', `/api/users/${member?.id}/roles`, {
      cookie: adminCookie,
      body: { roleIds: [ownerRole?.id] },
    })
    expect(response.status).toBe(403)
  })

  it('不能给自己分配角色（防自我提权）', async () => {
    const roles = await call('GET', '/api/roles', { cookie: adminCookie })
    const adminRoleId = (roles.json.items as { id: string; name: string }[]).find((role) => role.name === 'admin')?.id
    const me = await call('GET', '/api/me', { cookie: adminCookie })
    const myId = (me.json.user as { id: string }).id
    const response = await call('PUT', `/api/users/${myId}/roles`, {
      cookie: adminCookie,
      body: { roleIds: [adminRoleId] },
    })
    expect(response.status).toBe(403)
  })

  it('内置角色不可删除；被占用的角色删除被阻断', async () => {
    const roles = await call('GET', '/api/roles', { cookie: ownerCookie })
    const memberRole = (roles.json.items as { id: string; name: string; builtin: boolean }[]).find(
      (role) => role.name === 'member',
    )
    const response = await call('DELETE', `/api/roles/${memberRole?.id}`, { cookie: ownerCookie })
    expect(response.status).toBe(403)
  })
})

describe('题目导入与越权拦截', () => {
  it('owner 创建题库', async () => {
    const response = await call('POST', '/api/banks', {
      cookie: ownerCookie,
      body: { name: '演示题库', subject: '计算机基础', visibility: 'public' },
    })
    expect(response.status).toBe(201)
    bankId = String(response.json.id)
    expect(bankId).toBeTruthy()
  })

  it('member 直接调用导入接口返回 403（服务端拒绝，不是前端藏按钮）', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: JSON.stringify({ username: 'member1', password: memberInitial }),
    })
    memberCookie = cookieOf(login as unknown as { headers: Record<string, unknown> })
    await call('POST', '/api/me/finish-initial-password', {
      cookie: memberCookie,
      body: { newPassword: 'MemberPass123' },
    })

    const response = await call('POST', `/api/banks/${bankId}/import`, {
      cookie: memberCookie,
      body: { importId: 'x1', batchIndex: 0, batchCount: 1, questions: [] },
    })
    expect(response.status).toBe(403)
  })

  it('owner 导入一批题目成功，重复提交同一批返回 alreadyImported', async () => {
    const payload = {
      importId: 'test-import-1',
      batchIndex: 0,
      batchCount: 1,
      questions: [
        {
          type: 'single',
          no: 1,
          stem: '下列哪个是编译型语言？',
          options: [
            { key: 'A', text: 'Python' },
            { key: 'B', text: 'C' },
            { key: 'C', text: 'JavaScript' },
            { key: 'D', text: 'Ruby' },
          ],
          answer: ['B'],
          explanation: 'C 需要先编译为机器码。',
          difficulty: 2,
          tags: ['语言'],
          media: [],
          srcRef: null,
        },
        {
          type: 'judge',
          no: 2,
          stem: 'TCP 是面向连接的协议。',
          options: [],
          answer: ['T'],
          explanation: 'TCP 三次握手建立连接。',
          difficulty: 1,
          tags: [],
          media: [],
          srcRef: null,
        },
      ],
    }
    const first = await call('POST', `/api/banks/${bankId}/import`, { cookie: ownerCookie, body: payload })
    expect(first.status).toBe(200)
    expect(first.json.imported).toBe(2)

    const again = await call('POST', `/api/banks/${bankId}/import`, { cookie: ownerCookie, body: payload })
    expect(again.status).toBe(200)
    expect(again.json.alreadyImported).toBe(true)
    expect(again.json.totalSoFar).toBe(2)
  })

  it('导入后的题目可以按 order 取到并带章节', async () => {
    const response = await call('GET', `/api/banks/${bankId}/questions`, { cookie: ownerCookie })
    expect(response.status).toBe(200)
    const items = response.json.items as { stem: string }[]
    expect(items.length).toBe(2)
    expect(items[0]?.stem).toContain('编译型语言')
  })

  it('member 可以读题目但改题目被拒绝', async () => {
    const list = await call('GET', `/api/banks/${bankId}/questions`, { cookie: memberCookie })
    expect(list.status).toBe(200)
    const questionId = (list.json.items as { id: string }[])[0]?.id
    const response = await call('PATCH', `/api/questions/${questionId}`, {
      cookie: memberCookie,
      body: { stem: '被篡改的题干' },
    })
    expect(response.status).toBe(403)
  })
})

describe('角色权限变更即时生效', () => {
  it('新建「助教」角色后可导入，取消 question:import 后立刻 403 且无需重新登录', async () => {
    const roles = await call('GET', '/api/roles', { cookie: ownerCookie })
    const memberRole = (roles.json.items as { id: string; name: string }[]).find((role) => role.name === 'member')
    const created = await call('POST', '/api/roles', {
      cookie: ownerCookie,
      body: {
        name: '助教',
        description: '可导入与维护题目',
        perms: ['bank:read', 'bank:create', 'bank:update', 'question:read', 'question:import', 'question:update'],
      },
    })
    expect(created.status).toBe(201)
    const assistantId = String(created.json.id)

    const users = await call('GET', '/api/users', { cookie: ownerCookie })
    const member = (users.json.items as { id: string; username: string }[]).find((user) => user.username === 'member1')
    const assign = await call('PUT', `/api/users/${member?.id}/roles`, {
      cookie: ownerCookie,
      body: { roleIds: [String(memberRole?.id), assistantId] },
    })
    expect(assign.status).toBe(200)

    // 助教用自己的身份建题库并导入（数据归属校验：不能改他人题库）
    const ownBank = await call('POST', '/api/banks', {
      cookie: memberCookie,
      body: { name: '助教自建题库', visibility: 'private' },
    })
    expect(ownBank.status).toBe(201)
    const ownBankId = String(ownBank.json.id)

    const allowed = await call('POST', `/api/banks/${ownBankId}/import`, {
      cookie: memberCookie,
      body: { importId: 'assistant-1', batchIndex: 0, batchCount: 1, questions: [] },
    })
    expect(allowed.status).toBe(200)

    const patched = await call('PATCH', `/api/roles/${assistantId}`, {
      cookie: ownerCookie,
      body: { perms: ['bank:read', 'question:read'] },
    })
    expect(patched.status).toBe(200)

    const denied = await call('POST', `/api/banks/${ownBankId}/import`, {
      cookie: memberCookie,
      body: { importId: 'assistant-2', batchIndex: 0, batchCount: 1, questions: [] },
    })
    expect(denied.status).toBe(403)
  })
})
