import type { PublicSettings } from '@kaoshiya/shared'
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from '@kaoshiya/shared'
import type { Db } from '../db/index.js'
import { safeJsonParse } from '../util.js'

export function getSettings(db: Db): PublicSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const map = new Map(rows.map((row) => [row.key, safeJsonParse<unknown>(row.value, null)]))
  const passScore = Number(map.get(SETTINGS_KEYS.DEFAULT_PASS_SCORE))
  return {
    siteName: String(map.get(SETTINGS_KEYS.SITE_NAME) ?? DEFAULT_SETTINGS.siteName),
    defaultPassScore: Number.isFinite(passScore) ? passScore : DEFAULT_SETTINGS.defaultPassScore,
    guestEnabled: Boolean(map.get(SETTINGS_KEYS.GUEST_ENABLED) ?? DEFAULT_SETTINGS.guestEnabled),
  }
}

export function setSettings(db: Db, patch: Partial<PublicSettings>): PublicSettings {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  db.transaction(() => {
    if (patch.siteName !== undefined) stmt.run(SETTINGS_KEYS.SITE_NAME, JSON.stringify(patch.siteName))
    if (patch.defaultPassScore !== undefined)
      stmt.run(SETTINGS_KEYS.DEFAULT_PASS_SCORE, JSON.stringify(patch.defaultPassScore))
    if (patch.guestEnabled !== undefined) stmt.run(SETTINGS_KEYS.GUEST_ENABLED, JSON.stringify(patch.guestEnabled))
  })()
  return getSettings(db)
}
