import process from 'node:process'
import { ConfigError, loadConfig } from './config.js'
import { buildApp } from './app.js'

async function main(): Promise<void> {
  let config
  try {
    config = loadConfig()
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`配置错误：${err.message}\n`)
      process.exit(1)
    }
    throw err
  }

  const app = await buildApp({ config })
  if (config.isProduction && !config.publicOrigin.startsWith('http')) {
    app.log.warn('PUBLIC_ORIGIN 未正确配置，登录与 CSRF 校验会失败')
  }
  try {
    await app.listen({ port: config.port, host: config.host })
    app.log.info(
      { port: config.port, publicOrigin: config.publicOrigin, secureCookie: config.secureCookie },
      'KaoShiYa server started',
    )
  } catch (err) {
    app.log.error(err, '启动失败')
    process.exit(1)
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    try {
      await app.close()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

void main()
