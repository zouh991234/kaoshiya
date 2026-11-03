import crypto from 'node:crypto'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 短且无歧义的 ID（12 位 base36 + 前缀）。 */
export function newId(prefix: string): string {
  const bytes = crypto.randomBytes(8)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  const time = Date.now().toString(36).slice(-4)
  return `${prefix}_${time}${out.slice(0, 8)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

/** 生成一次性初始密码：易读、满足强度要求（含字母与数字）。 */
export function generateInitialPassword(): string {
  const letters = 'abcdefghijkmnpqrstuvwxyz'
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const pick = (set: string, count: number): string =>
    Array.from({ length: count }, () => set[crypto.randomInt(set.length)]).join('')
  return `${pick(upper, 2)}${pick(letters, 5)}${pick(digits, 3)}`
}

export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
