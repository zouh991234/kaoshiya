/**
 * 备份命令行：供 deploy/backup.sh 与 crontab 调用。
 * 使用 SQLite 在线备份 API，不直接复制正在写入的数据库文件。
 */
import process from 'node:process'
import { loadConfig } from './config.js'
import { openDatabase } from './db/index.js'
import { createBackup, listBackups } from './services/backup.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const db = openDatabase(config.databasePath)
  try {
    const manifest = await createBackup(db, config)
    const kept = listBackups(config)
    process.stdout.write(
      `备份完成：${manifest.id}\n用户 ${manifest.counts.users} · 题库 ${manifest.counts.banks} · 题目 ${manifest.counts.questions}\n媒体文件 ${manifest.mediaFiles} 个，数据库 ${(manifest.databaseBytes / 1024 / 1024).toFixed(2)} MB\n当前保留 ${kept.length} 份（上限 7 份）\n`,
    )
  } finally {
    db.close()
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`备份失败：${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
