import fs from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { SESSION_COOKIE } from '@kaoshiya/shared'
import { ZodError } from 'zod'
import type { AppConfig } from './config.js'
import { openDatabase } from './db/index.js'
import type { Db } from './db/index.js'
import { ensureBaseline, migrate } from './db/migrate.js'
import { PermResolver } from './rbac/resolve.js'
import { ApiError } from './errors.js'
import { registerRoutes } from './routes/index.js'
import { purgeExpiredSessions } from './auth/session.js'
import { sweepLoginGuard } from './auth/login-guard.js'

export interface BuildOptions {
  config: AppConfig
  db?: Db
  logger?: boolean
  /** 测试环境放宽 CSRF 同源校验（仍要求显式 Origin）。 */
  testMode?: boolean
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function securityHeaders(reply: FastifyReply, config: AppConfig): void {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
  reply.header('Content-Security-Policy', csp)
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'DENY')
  reply.header('Referrer-Policy', 'same-origin')
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  if (config.secureCookie) {
    reply.header('Strict-Transport-Security', 'max-age=15552000')
  }
}

function sameOrigin(request: FastifyRequest, config: AppConfig): boolean {
  const origin = request.headers.origin
  const referer = request.headers.referer
  const target = config.publicOrigin
  if (origin) return origin === target
  if (referer) {
    try {
      return new URL(referer).origin === target
    } catch {
      return false
    }
  }
  return false
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const { config } = options
  const db = options.db ?? openDatabase(config.databasePath)
  migrate(db)
  ensureBaseline(db)

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password', 'req.body.newPassword', '*.pwd_hash'],
              censor: '[redacted]',
            },
          },
    bodyLimit: 1024 * 1024,
    trustProxy: config.trustProxy,
    disableRequestLogging: false,
  })

  app.decorate('db', db)
  app.decorate('appConfig', config)
  app.decorate('perms', new PermResolver(db))
  app.decorateRequest('auth', null)

  await app.register(cookie)

  // 允许空 JSON 体（部分客户端会给无 body 的 DELETE/POST 也带上 content-type: application/json）
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : ''
    if (!text) {
      done(null, undefined)
      return
    }
    try {
      done(null, JSON.parse(text))
    } catch {
      done(new ApiError(400, 'INVALID_JSON', '请求体不是合法的 JSON'), undefined)
    }
  })

  // 图片以二进制直传（不引表单解析依赖），限制 2 MB
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp'],
    { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 },
    (_request, body, done) => {
      done(null, body)
    },
  )

  app.addHook('onSend', async (_request, reply) => {
    securityHeaders(reply, config)
    return undefined
  })

  app.addHook('onRequest', async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return
    if (!sameOrigin(request, config)) {
      request.log.warn({ url: request.url, origin: request.headers.origin }, 'csrf origin mismatch')
      reply.code(403).send({ code: 'CSRF_FORBIDDEN', message: '请求来源校验失败' })
      return
    }
  })

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    // 只对 /api 限流：一次页面加载会并发拉取十几个分块，静态资源计入会误伤正常用户
    allowList: (request) => !request.url.startsWith('/api/'),
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => ({ code: 'TOO_MANY_REQUESTS', message: '请求过于频繁，请稍后再试' }),
  })

  const mediaDir = config.mediaDir
  fs.mkdirSync(mediaDir, { recursive: true })
  await app.register(fastifyStatic, {
    root: mediaDir,
    prefix: '/media/',
    decorateReply: false,
    cacheControl: true,
    maxAge: '30d',
    immutable: true,
  })

  const hasWeb = fs.existsSync(path.join(config.webRoot, 'index.html'))
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: config.webRoot,
      prefix: '/',
      wildcard: false,
      decorateReply: false,
      setHeaders: (res, filePath) => {
        if (/\.(woff2|woff|ttf)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        if (/[\/]assets[\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
      },
    })
  }

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    if (error instanceof ApiError) {
      reply.code(error.statusCode).send({ code: error.code, message: error.message, details: error.details })
      return
    }
    if (error instanceof ZodError) {
      reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '请求参数不合法',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      })
      return
    }
    if (error.code === 'TOO_MANY_REQUESTS') {
      reply.code(429).send({ code: 'TOO_MANY_REQUESTS', message: error.message || '请求过于频繁，请稍后再试' })
      return
    }
    const statusCode =
      typeof error.statusCode === 'number' ? error.statusCode : reply.statusCode >= 400 ? reply.statusCode : 500
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error')
      reply.code(500).send({ code: 'INTERNAL_ERROR', message: '服务器内部错误' })
      return
    }
    reply.code(statusCode).send({ code: error.code ?? 'BAD_REQUEST', message: error.message })
  })

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ code: 'NOT_FOUND', message: '接口不存在' })
      return
    }
    const indexFile = path.join(config.webRoot, 'index.html')
    if (request.method === 'GET' && fs.existsSync(indexFile)) {
      reply.header('Cache-Control', 'no-cache')
      reply.type('text/html; charset=utf-8')
      reply.send(fs.createReadStream(indexFile))
      return
    }
    reply.code(404).send({ code: 'NOT_FOUND', message: '页面不存在' })
  })

  await registerRoutes(app)

  const timer = setInterval(() => {
    try {
      purgeExpiredSessions(db)
      sweepLoginGuard()
    } catch (err) {
      app.log.warn({ err }, 'session sweep failed')
    }
  }, 10 * 60_000)
  timer.unref()

  app.addHook('onClose', async () => {
    clearInterval(timer)
    if (!options.db) db.close()
  })

  return app
}

export { SESSION_COOKIE }
