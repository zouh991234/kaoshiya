import path from 'node:path'
import process from 'node:process'

export interface AppConfig {
  port: number
  host: string
  databasePath: string
  dataDir: string
  mediaDir: string
  backupDir: string
  publicOrigin: string
  secureCookie: boolean
  logLevel: string
  webRoot: string
  isProduction: boolean
  trustProxy: boolean
}

export class ConfigError extends Error {}

function parseOrigin(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConfigError(`PUBLIC_ORIGIN 不是合法 URL：${raw}（示例：http://1.2.3.4:20260）`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`PUBLIC_ORIGIN 必须以 http:// 或 https:// 开头：${raw}`)
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError(`PUBLIC_ORIGIN 只能是「协议 + 主机 + 端口」，不要带路径：${raw}`)
  }
  return url
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production'
  const dataDir = path.resolve(env.DATA_DIR ?? './data')
  const rawOrigin = env.PUBLIC_ORIGIN?.trim() ?? ''
  if (!rawOrigin) {
    throw new ConfigError('缺少 PUBLIC_ORIGIN 环境变量（示例：http://1.2.3.4:20260）')
  }
  const origin = parseOrigin(rawOrigin)
  const port = Number(env.PORT ?? 3300)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`PORT 不合法：${env.PORT ?? ''}`)
  }
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    databasePath: path.resolve(env.DATABASE_PATH ?? path.join(dataDir, 'kaoshiya.db')),
    dataDir,
    mediaDir: path.resolve(env.MEDIA_DIR ?? path.join(dataDir, 'media')),
    backupDir: path.resolve(env.BACKUP_DIR ?? path.join(dataDir, 'backups')),
    publicOrigin: origin.origin,
    // HTTP 直连不设置 Secure，HTTPS 必须设置，否则登录状态会失效
    secureCookie: origin.protocol === 'https:',
    logLevel: env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    webRoot: path.resolve(env.WEB_ROOT ?? './apps/web/dist'),
    isProduction,
    // 直连部署不信任任意客户端传入的代理头
    trustProxy: env.TRUST_PROXY === 'true',
  }
}
